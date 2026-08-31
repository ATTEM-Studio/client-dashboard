const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const auth = require('../api/auth');

const REDIS_URL = 'https://redis.example.test';
const PLATFORM_IP = '198.51.100.8';
const ANONYMOUS_ID = 'anonymous-client-id-1234';

process.env.TEAM_PASSWORD = 'correct-team-password';
process.env.KV_REST_API_URL = REDIS_URL;
process.env.KV_REST_API_TOKEN = 'redis-test-token';

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function request(password, options = {}) {
  const anonymous = options.anonymous === undefined ? ANONYMOUS_ID : options.anonymous;
  return {
    method: options.method || 'POST',
    query: options.action ? { action: options.action } : {},
    headers: {
      'x-vercel-forwarded-for': options.platformIp || PLATFORM_IP,
      'x-forwarded-for': options.forwardedFor || '203.0.113.250',
      ...(anonymous ? { cookie: '__Host-client-dashboard-anonymous=' + anonymous } : {})
    },
    body: { password }
  };
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function redisDouble() {
  const counters = new Map();
  const blocks = new Map();
  const calls = [];

  return {
    calls,
    async fetch(url, options) {
      calls.push({ url, options });
      assert.equal(url, REDIS_URL);
      assert.equal(options.method, 'POST');
      assert.match(options.headers.Authorization, /^Bearer /);
      assert.ok(options.signal, 'Redis requests have a bounded abort signal');
      const command = JSON.parse(options.body);
      if (command[0] === 'DEL') {
        for (const key of command.slice(1)) counters.delete(key);
        return { ok: true, async json() { return { result: 1 }; } };
      }
      const [name, script, keyCount, ...args] = command;

      if (name === 'EVAL' && keyCount === 2) {
        const [ipBlock, anonymousBlock] = args;
        const result = [blocks.has(ipBlock) ? 1 : 0, blocks.has(anonymousBlock) ? 1 : 0];
        return { ok: true, async json() { return { result }; } };
      }
      if (name === 'EVAL' && keyCount === 4) {
        const [ipCounter, ipBlock, anonymousCounter, anonymousBlock, window, limit, blockTtl] = args;
        assert.equal(window, '600');
        assert.equal(limit, '5');
        assert.equal(blockTtl, '900');
        const ipAttempts = Number(counters.get(ipCounter) || 0) + 1;
        const anonymousAttempts = Number(counters.get(anonymousCounter) || 0) + 1;
        counters.set(ipCounter, ipAttempts);
        counters.set(anonymousCounter, anonymousAttempts);
        if (ipAttempts >= Number(limit)) blocks.set(ipBlock, Number(blockTtl));
        if (anonymousAttempts >= Number(limit)) blocks.set(anonymousBlock, Number(blockTtl));
        const result = [blocks.has(ipBlock) ? 1 : 0, blocks.has(anonymousBlock) ? 1 : 0];
        return { ok: true, async json() { return { result }; } };
      }
      throw new Error('unexpected Redis command: ' + name + ' ' + script);
    }
  };
}

async function call(password, options) {
  const res = responseRecorder();
  await auth(request(password, options), res);
  return res;
}

async function main() {
  const previousFetch = global.fetch;
  const redis = redisDouble();
  global.fetch = redis.fetch;

  try {
    const success = await call('correct-team-password');
    assert.equal(success.statusCode, 200);
    assert.deepEqual(success.body, { ok: true });
    assert.equal(Object.hasOwn(success.body, 'token'), false);
    assert.equal(Object.hasOwn(success.body, 'redisConfigured'), false);
    assert.match(String(success.headers['set-cookie']), /HttpOnly/);

    const spoofedForwardedFor = '198.18.0.1';
    const failures = await Promise.all(Array.from({ length: 5 }, () =>
      call('wrong-password', { forwardedFor: spoofedForwardedFor })
    ));
    assert.equal(failures.filter((res) => res.statusCode === 401).length, 4);
    assert.equal(failures.filter((res) => res.statusCode === 429).length, 1);

    const expectedIpKey = 'client-dashboard:auth-fail:ip:' + digest(PLATFORM_IP);
    const expectedAnonymousKey = 'client-dashboard:auth-fail:anonymous:' + digest(ANONYMOUS_ID);
    const serializedCalls = JSON.stringify(redis.calls);
    assert.match(serializedCalls, new RegExp(expectedIpKey));
    assert.match(serializedCalls, new RegExp(expectedAnonymousKey));
    assert.doesNotMatch(serializedCalls, new RegExp(spoofedForwardedFor));
    assert.doesNotMatch(serializedCalls, new RegExp(PLATFORM_IP));
    assert.doesNotMatch(serializedCalls, new RegExp(ANONYMOUS_ID));

    const resetPlatformIp = '198.51.100.77';
    const resetAnonymous = 'reset-anonymous-client-id';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      assert.equal((await call('wrong-password', {
        platformIp: resetPlatformIp,
        anonymous: resetAnonymous
      })).statusCode, 401);
    }
    assert.equal((await call('correct-team-password', {
      platformIp: resetPlatformIp,
      anonymous: resetAnonymous
    })).statusCode, 200);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      assert.equal((await call('wrong-password', {
        platformIp: resetPlatformIp,
        anonymous: resetAnonymous
      })).statusCode, 401);
    }

    const correctDuringIpBlock = await call('correct-team-password', { anonymous: 'different-anonymous-client' });
    assert.equal(correctDuringIpBlock.statusCode, 429);
    assert.match(correctDuringIpBlock.body.error, /잠시 후/);

    const anonymousFailures = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      anonymousFailures.push(await call('wrong-password', {
        anonymous: 'second-anonymous-clientx',
        platformIp: '198.51.100.99'
      }));
    }
    assert.equal(anonymousFailures.at(-1).statusCode, 429);
    const correctDuringAnonymousBlock = await call('correct-team-password', {
      anonymous: 'second-anonymous-clientx',
      platformIp: '198.51.100.100'
    });
    assert.equal(correctDuringAnonymousBlock.statusCode, 429);

    const issuedAnonymous = await call('wrong-password', {
      anonymous: '',
      platformIp: '198.51.100.222'
    });
    assert.equal(issuedAnonymous.statusCode, 401);
    assert.match(String(issuedAnonymous.headers['set-cookie']), /__Host-client-dashboard-anonymous=/);
    assert.match(String(issuedAnonymous.headers['set-cookie']), /HttpOnly/);

    const logout = await call('', { action: 'logout' });
    assert.equal(logout.statusCode, 200);
    assert.match(String(logout.headers['set-cookie']), /Max-Age=0/);

    const nonPost = await call('', { method: 'GET' });
    assert.equal(nonPost.statusCode, 405);
    assert.equal(nonPost.headers.allow, 'POST');
    const unknownAction = await call('', { action: 'reset' });
    assert.equal(unknownAction.statusCode, 400);
  } finally {
    global.fetch = previousFetch;
  }

  const configuredUrl = process.env.KV_REST_API_URL;
  const configuredToken = process.env.KV_REST_API_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  try {
    const missingRedis = await call('correct-team-password');
    assert.equal(missingRedis.statusCode, 503);
    assert.doesNotMatch(JSON.stringify(missingRedis.body), /REDIS|KV_REST|UPSTASH/i);
  } finally {
    process.env.KV_REST_API_URL = configuredUrl;
    process.env.KV_REST_API_TOKEN = configuredToken;
  }

  const previousFailureFetch = global.fetch;
  global.fetch = async () => { throw new Error('upstream Redis failure'); };
  try {
    const failedRedis = await call('correct-team-password');
    assert.equal(failedRedis.statusCode, 503);
    assert.doesNotMatch(JSON.stringify(failedRedis.body), /upstream|Redis/i);
  } finally {
    global.fetch = previousFailureFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
