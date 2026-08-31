const crypto = require('node:crypto');

const sessionCookieName = '__Host-client-dashboard-session';
const SESSION_SECONDS = 12 * 60 * 60;

function secret() {
  const value = process.env.TEAM_PASSWORD;
  if (!value) throw new Error('AUTH_NOT_CONFIGURED');
  return value;
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function issueSession(res, now = Date.now()) {
  const payload = encode(JSON.stringify({
    iat: now,
    exp: now + SESSION_SECONDS * 1000,
    nonce: crypto.randomBytes(18).toString('base64url')
  }));
  const token = payload + '.' + sign(payload);
  res.setHeader('Set-Cookie',
    sessionCookieName + '=' + token +
    '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + SESSION_SECONDS);
}

function clearSession(res) {
  res.setHeader('Set-Cookie',
    sessionCookieName + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}

function parseCookies(header) {
  return String(header || '').split(';').reduce((out, item) => {
    const index = item.indexOf('=');
    if (index > 0) out[item.slice(0, index).trim()] = item.slice(index + 1).trim();
    return out;
  }, {});
}

function isAuthenticated(req, now = Date.now()) {
  try {
    const token = parseCookies(req.headers && req.headers.cookie)[sessionCookieName];
    if (!token) return false;
    const parts = token.split('.');
    if (parts.length !== 2 || !constantTimeEqual(parts[1], sign(parts[0]))) return false;
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return Number.isFinite(payload.iat) &&
      Number.isFinite(payload.exp) &&
      payload.iat <= now &&
      payload.exp >= now &&
      payload.exp - payload.iat === SESSION_SECONDS * 1000;
  } catch {
    return false;
  }
}

module.exports = {
  issueSession, clearSession, isAuthenticated,
  constantTimeEqual, sessionCookieName
};
