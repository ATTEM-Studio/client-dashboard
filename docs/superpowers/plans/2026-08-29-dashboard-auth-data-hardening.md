# Dashboard Authentication and Data Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser-stored team password with a signed HttpOnly session and add request, duplicate-action, and public-document protections without changing existing Redis data or customer links.

**Architecture:** Add a shared server-side authentication module used by every protected Vercel Function. The browser authenticates with a same-origin cookie and never receives or stores the team password. Existing public guide, contract, and report reads remain compatible while new documents and mutations receive stronger identifiers, validation, and duplicate-submit protection.

**Tech Stack:** Node.js Vercel Functions, Node `crypto`, Upstash Redis REST, vanilla JavaScript, Node test runner and `assert`.

**Spec:** `docs/superpowers/specs/2026-08-29-dashboard-operational-hardening-design.md`

## Global Constraints

- Preserve every existing Redis key and stored document.
- Preserve all already-issued contract, guide, and report links.
- Do not add a paid dependency or authentication provider.
- Keep the password-free browser demo temporarily available.
- Demo mode must issue zero production API requests.
- Support desktop, tablet, and 390px mobile.
- Never print, commit, or return passwords, Redis tokens, Naver secrets, or signed session values.
- Every production-code change starts with a failing test and ends with the full test suite.
- Each task is committed and deployed independently only after focused and full verification pass.

---

### Task 1: Shared Signed Session Module

**Files:**
- Create: `api/_session.js`
- Create: `tests/session-auth.test.js`

**Interfaces:**
- Consumes: `process.env.TEAM_PASSWORD`, request headers, response `setHeader`.
- Produces: `issueSession(res, now?)`, `clearSession(res)`, `isAuthenticated(req, now?)`, `sessionCookieName`, `constantTimeEqual(a, b)`.

- [ ] **Step 1: Write the failing session tests**

Create `tests/session-auth.test.js`:

```js
const assert = require('node:assert/strict');
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

const pair = String(cookie).split(';')[0];
assert.equal(isAuthenticated({ headers: { cookie: pair } }, now + 1000), true);
assert.equal(isAuthenticated({ headers: { cookie: pair + 'x' } }, now + 1000), false);
assert.equal(isAuthenticated({ headers: { cookie: pair } }, now + 43200001), false);
assert.equal(constantTimeEqual('same', 'same'), true);
assert.equal(constantTimeEqual('same', 'different'), false);

const logout = responseRecorder();
clearSession(logout);
assert.match(logout.headers['set-cookie'], /Max-Age=0/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node tests/session-auth.test.js`

Expected: FAIL because `api/_session.js` does not exist.

- [ ] **Step 3: Implement the minimal session module**

Create `api/_session.js`:

```js
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
```

- [ ] **Step 4: Run focused and full tests**

```bash
node tests/session-auth.test.js
for f in tests/*.test.js; do node "$f" || exit 1; done
```

Expected: all tests exit 0 and no secret value appears in output.

- [ ] **Step 5: Commit**

```bash
git add api/_session.js tests/session-auth.test.js
git commit -m "Add signed HttpOnly dashboard sessions"
```

---

### Task 2: Login, Logout, and Brute-Force Protection

**Files:**
- Modify: `api/auth.js`
- Create: `tests/auth-endpoint.test.js`

**Interfaces:**
- Consumes: Task 1 session functions and existing Redis REST configuration.
- Produces: `POST /api/auth?action=login`, `POST /api/auth?action=logout`, authenticated cookie, Redis-backed login failure counters.

- [ ] **Step 1: Write failing endpoint tests**

Create response recorders and a Redis `fetch` test double supporting `INCR`, `EXPIRE`, and `DEL`. Assert:

```js
assert.equal(success.statusCode, 200);
assert.deepEqual(success.body, { ok: true, redisConfigured: true });
assert.equal(Object.hasOwn(success.body, 'token'), false);
assert.match(success.headers['set-cookie'], /HttpOnly/);

assert.equal(badAttempt.statusCode, 401);
assert.equal(sixthAttempt.statusCode, 429);
assert.match(sixthAttempt.body.error, /잠시 후/);

assert.equal(logout.statusCode, 200);
assert.match(logout.headers['set-cookie'], /Max-Age=0/);
```

Verify the rate-limit key contains only a SHA-256 digest of the client address, never the raw address.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node tests/auth-endpoint.test.js`

Expected: FAIL because the current endpoint returns `token: expected`, has no logout action, and has no failed-attempt limit.

- [ ] **Step 3: Implement login and logout**

Update `api/auth.js` to accept only POST, default `action` to `login`, clear the cookie for logout, compare through `constantTimeEqual`, call `issueSession(res)` after success, and return only `{ ok: true, redisConfigured }`.

Add:

```js
function clientAddress(req) {
  return String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown')
    .split(',')[0].trim();
}

function attemptKey(req) {
  return 'client-dashboard:auth-fail:' +
    crypto.createHash('sha256').update(clientAddress(req)).digest('hex');
}
```

Use Redis `INCR`, set a 10-minute expiry on the first failure, return 429 after five failures, and delete the failure key after successful login. If Redis is unavailable, authentication still performs the password comparison but does not expose Redis details.

- [ ] **Step 4: Verify endpoint and regression tests**

```bash
node tests/auth-endpoint.test.js
node tests/session-auth.test.js
for f in tests/*.test.js; do node "$f" || exit 1; done
```

Expected: exit 0; auth responses never contain `TEAM_PASSWORD` or a `token` property.

- [ ] **Step 5: Commit**

```bash
git add api/auth.js tests/auth-endpoint.test.js
git commit -m "Harden dashboard login and logout"
```

---

### Task 3: Apply Cookie Authentication to Protected APIs

**Files:**
- Modify: `api/data.js`
- Modify: `api/naver-keyword.js`
- Modify: `api/naver-datalab.js`
- Modify: `tests/client-information-guide.test.js`
- Modify: `tests/naver-datalab.test.js`
- Create: `tests/protected-api-session.test.js`

**Interfaces:**
- Consumes: `isAuthenticated(req)` from Task 1.
- Produces: consistent cookie authorization for every protected operation.

- [ ] **Step 1: Write failing protected-API tests**

Test the handlers with an unauthenticated request and with a cookie created by Task 1. Repeat for both Naver endpoints. Preserve tests proving exact public guide, contract, and report reads remain unauthenticated.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node tests/protected-api-session.test.js`

Expected: FAIL because protected handlers only accept the team password header.

- [ ] **Step 3: Replace duplicated authentication guards**

In each API:

```js
const { isAuthenticated, constantTimeEqual } = require('./_session');
```

Use `isAuthenticated(req)`. Do not accept `x-team-token` or `Authorization: Bearer <team password>` by default. A temporary legacy path may be enabled only when `LEGACY_HEADER_AUTH === 'true'`; it must use `constantTimeEqual`.

- [ ] **Step 4: Verify public and protected routes**

```bash
node tests/protected-api-session.test.js
node tests/client-guide-api.test.js
node tests/client-information-guide.test.js
node tests/naver-datalab.test.js
for f in tests/*.test.js; do node "$f" || exit 1; done
```

Expected: public customer links pass without a cookie; all staff data and Naver API calls return 401 without a valid session.

- [ ] **Step 5: Commit**

```bash
git add api/data.js api/naver-keyword.js api/naver-datalab.js tests
git commit -m "Protect dashboard APIs with session cookies"
```

---

### Task 4: Remove Browser Password Storage

**Files:**
- Modify: `index.html`
- Modify: `tests/browser-demo-mode.test.js`
- Create: `tests/browser-session-flow.test.js`

**Interfaces:**
- Consumes: Task 2 auth actions and same-origin browser cookies.
- Produces: staff login state without `localStorage` credentials and demo-to-staff isolation.

- [ ] **Step 1: Write failing browser-source tests**

```js
const html = fs.readFileSync('index.html', 'utf8');
assert.doesNotMatch(html, /rs:team-token/);
assert.doesNotMatch(html, /localStorage\.setItem\(AUTH_KEY/);
assert.doesNotMatch(html, /"x-team-token"/);
assert.doesNotMatch(html, /Authorization['"]?:['"]?Bearer/);
assert.match(html, /fetch\("\/api\/auth\?action=logout"/);
assert.match(html, /credentials:\s*"same-origin"/);
```

Extend the demo test so entering demo mode never calls auth, data, guide, or Naver endpoints.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node tests/browser-session-flow.test.js
node tests/browser-demo-mode.test.js
```

Expected: FAIL because the current browser stores `rs:team-token` and sends password headers.

- [ ] **Step 3: Implement cookie-based browser flow**

Remove `AUTH_KEY`, `authToken`, and localStorage credential operations. Add `credentials: "same-origin"` to staff API requests. Treat 401 as session expiry, preserve visible draft state, and render login. Login ignores token fields. Logout posts `/api/auth?action=logout`. Demo mode must not call staff APIs or infer staff authentication.

- [ ] **Step 4: Verify session, demo, syntax, and full suite**

```bash
node tests/browser-session-flow.test.js
node tests/browser-demo-mode.test.js
node tests/inline-script-syntax.test.js
for f in tests/*.test.js; do node "$f" || exit 1; done
```

Expected: exit 0 and no browser source contains the team-password storage key.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/browser-session-flow.test.js tests/browser-demo-mode.test.js
git commit -m "Remove browser-stored team credentials"
```

---

### Task 5: Strong Report IDs and Public Response Whitelists

**Files:**
- Modify: `index.html`
- Modify: `api/data.js`
- Modify: `tests/revenue-reporting.test.js`
- Create: `tests/public-document-security.test.js`

**Interfaces:**
- Consumes: existing `report:<id>`, `contract:<id>`, and `guide:<id>` Redis documents.
- Produces: `publicId(prefix)` for new reports and sanitized public reads.

- [ ] **Step 1: Write failing identifier and sanitization tests**

Test 1,000 real helper calls are unique and match `/^rpt_[A-Fa-f0-9]{48}$/`. Test a public report containing `internalMemo`, `owner`, and unexpected nested fields does not return those fields. Verify a legacy `rpt_<timestamp><random>` link remains readable.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node tests/public-document-security.test.js`

Expected: FAIL because report creation uses `uid("rpt")` and public report reads return the stored value without a whitelist.

- [ ] **Step 3: Implement new IDs and sanitizers**

```js
function publicId(prefix) {
  var bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return prefix + '_' + Array.prototype.map.call(bytes, function(byte) {
    return byte.toString(16).padStart(2, '0');
  }).join('');
}
```

Use `publicId("rpt")` for new reports only. Sanitize public report reads to the explicit fields consumed by `renderReportView`; recursively copy only allowed strings and finite numbers within documented limits.

- [ ] **Step 4: Verify old and new links**

```bash
node tests/public-document-security.test.js
node tests/revenue-reporting.test.js
node tests/contract-management.test.js
node tests/client-information-guide.test.js
for f in tests/*.test.js; do node "$f" || exit 1; done
```

Expected: new reports use high-entropy IDs, legacy report links remain readable, and public responses omit internal fields.

- [ ] **Step 5: Commit**

```bash
git add index.html api/data.js tests
git commit -m "Harden public report identifiers and responses"
```

---

### Task 6: Duplicate-Action and Payload Guards

**Files:**
- Modify: `api/data.js`
- Modify: `api/guide.js`
- Modify: `index.html`
- Create: `tests/request-guards.test.js`
- Modify: `tests/contract-management.test.js`
- Modify: `tests/client-information-guide.test.js`

**Interfaces:**
- Consumes: authenticated and public mutations.
- Produces: `withPendingAction(key, action)` in the browser and server validation helpers.

- [ ] **Step 1: Write failing request-guard tests**

Cover double contract submission, double renewal confirmation, shared in-flight guide submission, bodies over 2 MB, more than 200 checklist items, signature data URLs over 1.5 MB, and ignored unexpected public fields. Use a deferred Promise to prove two browser calls share one request.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node tests/request-guards.test.js`

Expected: FAIL because pending actions are protected inconsistently and server limits are incomplete.

- [ ] **Step 3: Implement browser action deduplication**

```js
var pendingActions = new Map();
function withPendingAction(key, action) {
  if (pendingActions.has(key)) return pendingActions.get(key);
  var promise = Promise.resolve().then(action).finally(function() {
    pendingActions.delete(key);
  });
  pendingActions.set(key, promise);
  return promise;
}
```

Wrap contract submit, guide submit, renewal confirm, and destructive deletes with stable document-specific keys. Disable the initiating button during the shared Promise and restore it in `finally`.

- [ ] **Step 4: Implement server payload guards**

```js
function jsonSize(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function rejectLargeBody(res, value, max = 2_000_000) {
  if (jsonSize(value) <= max) return false;
  res.status(413).json({ error: '저장할 데이터가 너무 큽니다' });
  return true;
}
```

Apply exact maximum lengths and collection counts to contracts, guides, clients, reports, and checklist sets. Keep existing public whitelist functions authoritative.

- [ ] **Step 5: Run focused and full tests**

```bash
node tests/request-guards.test.js
node tests/contract-management.test.js
node tests/client-information-guide.test.js
for f in tests/*.test.js; do node "$f" || exit 1; done
```

Expected: all tests pass and every duplicate-action assertion records one transport call.

- [ ] **Step 6: Commit**

```bash
git add api/data.js api/guide.js index.html tests
git commit -m "Prevent duplicate dashboard mutations"
```

---

### Task 7: CI, Security Headers, and Production Gate

**Files:**
- Create: `.github/workflows/dashboard-quality.yml`
- Create: `tests/security-regression.test.js`
- Modify: `vercel.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: all tests from Tasks 1–6.
- Produces: reproducible quality command and GitHub status check.

- [ ] **Step 1: Write the security regression test**

Assert browser source does not store credentials, auth source does not return the expected password, API source does not authorize through `authToken`, and `vercel.json` includes a Content Security Policy.

- [ ] **Step 2: Run the security test and verify RED**

Run: `node tests/security-regression.test.js`

Expected: FAIL until the final header and credential-removal requirements are present.

- [ ] **Step 3: Add security headers**

Because the current application uses an inline script, compute its exact SHA-256 hash during implementation and pin it in `script-src`. Add `default-src 'self'`, restrictive `connect-src`, `object-src 'none'`, `base-uri 'self'`, and `frame-ancestors 'self'`. Recompute the hash whenever the inline script changes; the security test must fail if the configured hash differs.

- [ ] **Step 4: Create the GitHub Actions workflow**

```yaml
name: Dashboard Quality
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: |
          set -e
          for file in tests/*.test.js; do
            node "$file"
          done
```

- [ ] **Step 5: Document verification**

Add this command to README:

```bash
for file in tests/*.test.js; do node "$file" || exit 1; done
```

Document required Vercel environment-variable names only. Never include values.

- [ ] **Step 6: Run the complete local gate**

```bash
node tests/security-regression.test.js
for f in tests/*.test.js; do node "$f" || exit 1; done
```

Expected: exit 0 with zero failures.

- [ ] **Step 7: Commit and verify Preview**

```bash
git add .github/workflows/dashboard-quality.yml tests/security-regression.test.js README.md vercel.json
git commit -m "Add dashboard security and quality gate"
```

Verify in Vercel Preview:

- login succeeds without a browser-stored password;
- refresh keeps the session until expiry;
- logout blocks protected data;
- demo entry performs zero staff API calls;
- an existing guide, contract, and report link opens;
- 390px viewport has no horizontal overflow;
- runtime error count for the preview deployment is zero.

- [ ] **Step 8: Production verification**

After Preview and GitHub checks pass, promote the verified commit. Confirm production SHA equals GitHub `main`, deployment is `READY`, protected endpoints return 401 without a session, public endpoints expose only allowed fields, and runtime errors remain zero after smoke requests.

