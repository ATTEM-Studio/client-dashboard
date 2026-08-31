const crypto = require('node:crypto');
const { clearSession, constantTimeEqual, issueSession } = require('./_session');

const COUNTER_TTL_SECONDS = 10 * 60;
const BLOCK_TTL_SECONDS = 15 * 60;
const MAX_FAILURES = 5;
const REDIS_TIMEOUT_MS = 2_000;
const anonymousCookieName = '__Host-client-dashboard-anonymous';

const BLOCK_STATUS_SCRIPT = `
return {
  redis.call('EXISTS', KEYS[1]),
  redis.call('EXISTS', KEYS[2])
}`;

const RECORD_FAILURE_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 or redis.call('EXISTS', KEYS[4]) == 1 then
  return { 1, 1 }
end
local ipCount = redis.call('INCR', KEYS[1])
local anonymousCount = redis.call('INCR', KEYS[3])
if ipCount == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if anonymousCount == 1 then redis.call('EXPIRE', KEYS[3], ARGV[1]) end
if ipCount >= tonumber(ARGV[2]) then redis.call('SET', KEYS[2], '1', 'EX', ARGV[3]) end
if anonymousCount >= tonumber(ARGV[2]) then redis.call('SET', KEYS[4], '1', 'EX', ARGV[3]) end
return {
  redis.call('EXISTS', KEYS[2]),
  redis.call('EXISTS', KEYS[4])
}`;

function redisEnv() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  };
}

async function redisCommand(command) {
  const { url, token } = redisEnv();
  if (!url || !token) throw new Error('REDIS_UNAVAILABLE');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REDIS_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command),
      signal: controller.signal
    });
    if (!response.ok) throw new Error('REDIS_UNAVAILABLE');
    const payload = await response.json();
    if (!payload || !Object.hasOwn(payload, 'result')) throw new Error('REDIS_UNAVAILABLE');
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

function parseCookies(header) {
  return String(header || '').split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator > 0) cookies[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
    return cookies;
  }, {});
}

function trustedPlatformAddress(req) {
  const headers = req.headers || {};
  return String(headers['x-vercel-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown').trim();
}

function anonymousClient(req) {
  const value = parseCookies(req.headers && req.headers.cookie)[anonymousCookieName];
  if (typeof value === 'string' && /^[A-Za-z0-9_-]{24,}$/.test(value)) {
    return { id: value, cookie: null };
  }
  const id = crypto.randomBytes(18).toString('base64url');
  return {
    id,
    cookie: anonymousCookieName + '=' + id +
      '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200'
  };
}

function appendCookie(res, cookie) {
  if (!cookie) return;
  const existing = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : undefined;
  res.setHeader('Set-Cookie', existing ? [].concat(existing, cookie) : cookie);
}

function rateLimitKeys(req, anonymous) {
  const ipDigest = crypto.createHash('sha256').update(trustedPlatformAddress(req)).digest('hex');
  const anonymousDigest = crypto.createHash('sha256').update(anonymous.id).digest('hex');
  return {
    ipCounter: 'client-dashboard:auth-fail:ip:' + ipDigest + ':counter',
    ipBlock: 'client-dashboard:auth-fail:ip:' + ipDigest + ':block',
    anonymousCounter: 'client-dashboard:auth-fail:anonymous:' + anonymousDigest + ':counter',
    anonymousBlock: 'client-dashboard:auth-fail:anonymous:' + anonymousDigest + ':block'
  };
}

function isBlocked(result) {
  return Array.isArray(result) && result.some((value) => Number(value) > 0);
}

async function blocked(keys) {
  return isBlocked(await redisCommand([
    'EVAL', BLOCK_STATUS_SCRIPT, 2, keys.ipBlock, keys.anonymousBlock
  ]));
}

async function recordFailure(keys) {
  return isBlocked(await redisCommand([
    'EVAL', RECORD_FAILURE_SCRIPT, 4,
    keys.ipCounter, keys.ipBlock, keys.anonymousCounter, keys.anonymousBlock,
    String(COUNTER_TTL_SECONDS), String(MAX_FAILURES), String(BLOCK_TTL_SECONDS)
  ]));
}

async function clearFailures(keys) {
  await redisCommand(['DEL', keys.ipCounter, keys.anonymousCounter]);
}

function unavailable(res, anonymous) {
  appendCookie(res, anonymous.cookie);
  return res.status(503).json({ error: '인증 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요' });
}

function respond(res, status, body, anonymous) {
  appendCookie(res, anonymous && anonymous.cookie);
  return res.status(status).json(body);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: '허용되지 않은 메서드입니다' });
  }

  const action = (req.query && req.query.action) || 'login';
  if (action === 'logout') {
    clearSession(res);
    return res.status(200).json({ ok: true });
  }
  if (action !== 'login') {
    return res.status(400).json({ error: '허용되지 않은 요청입니다' });
  }

  const anonymous = anonymousClient(req);
  const keys = rateLimitKeys(req, anonymous);
  try {
    if (await blocked(keys)) {
      return respond(res, 429, { ok: false, error: '잠시 후 다시 시도해 주세요' }, anonymous);
    }
  } catch {
    return unavailable(res, anonymous);
  }

  const expected = process.env.TEAM_PASSWORD;
  if (!expected) {
    return respond(res, 503, { error: '인증 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요' }, anonymous);
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const given = (body && body.password) || '';

  if (!constantTimeEqual(given, expected)) {
    try {
      if (await recordFailure(keys)) {
        return respond(res, 429, { ok: false, error: '잠시 후 다시 시도해 주세요' }, anonymous);
      }
    } catch {
      return unavailable(res, anonymous);
    }
    return respond(res, 401, { ok: false, error: '비밀번호가 올바르지 않습니다' }, anonymous);
  }

  try {
    await clearFailures(keys);
  } catch {
    return unavailable(res, anonymous);
  }
  issueSession(res);
  appendCookie(res, anonymous.cookie);
  return res.status(200).json({ ok: true });
};
