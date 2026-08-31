const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  issueSession, clearSession, isAuthenticated,
  constantTimeEqual, sessionCookieName
} = require('../api/_session');

process.env.TEAM_PASSWORD = 'test-password-with-sufficient-length';

function responseRecorder() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  };
}

const now = Date.UTC(2026, 7, 29, 12);
const res = responseRecorder();
issueSession(res, now);
const cookie = res.headers['set-cookie'];
assert.match(cookie, new RegExp('^' + sessionCookieName + '='));
assert.match(cookie, /HttpOnly/);
assert.match(cookie, /Secure/);
assert.match(cookie, /SameSite=Lax/);
assert.match(cookie, /Max-Age=43200/);
assert.match(cookie, /Path=\//);
assert.doesNotMatch(cookie, /(?:^|;)\s*Domain=/i);
assert.doesNotMatch(cookie, /test-password-with-sufficient-length/);

const pair = String(cookie).split(';')[0];
assert.equal(isAuthenticated({ headers: { cookie: pair } }, now + 1000), true);
assert.equal(isAuthenticated({ headers: { cookie: pair + 'x' } }, now + 1000), false);
assert.equal(isAuthenticated({ headers: { cookie: pair } }, now + 43200001), false);
assert.equal(isAuthenticated({ headers: {} }, now), false);
assert.equal(isAuthenticated({}, now), false);
assert.equal(isAuthenticated({ headers: { cookie: sessionCookieName } }, now), false);
assert.equal(isAuthenticated({ headers: { cookie: sessionCookieName + '=malformed' } }, now), false);

const future = responseRecorder();
issueSession(future, now + 1000);
assert.equal(
  isAuthenticated({ headers: { cookie: String(future.headers['set-cookie']).split(';')[0] } }, now),
  false
);

const invalidShapePayload = Buffer.from(JSON.stringify([])).toString('base64url');
const invalidShapeSignature = crypto.createHmac('sha256', process.env.TEAM_PASSWORD)
  .update(invalidShapePayload)
  .digest('base64url');
assert.equal(
  isAuthenticated({ headers: { cookie: sessionCookieName + '=' + invalidShapePayload + '.' + invalidShapeSignature } }, now),
  false
);
assert.equal(constantTimeEqual('same', 'same'), true);
assert.equal(constantTimeEqual('same', 'different'), false);

const logout = responseRecorder();
clearSession(logout);
assert.match(logout.headers['set-cookie'], /Max-Age=0/);

const configuredPassword = process.env.TEAM_PASSWORD;
delete process.env.TEAM_PASSWORD;
try {
  assert.throws(
    () => issueSession(responseRecorder(), now),
    { message: 'AUTH_NOT_CONFIGURED' }
  );
  assert.equal(isAuthenticated({ headers: { cookie: pair } }, now), false);
} finally {
  process.env.TEAM_PASSWORD = configuredPassword;
}
