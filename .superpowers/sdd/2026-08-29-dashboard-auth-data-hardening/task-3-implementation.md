# Task 3 Implementation Report: Cookie Authentication for Protected APIs

## Result

Protected dashboard data operations and both Naver proxy endpoints now accept
only the signed session cookie verified by `isAuthenticated(req)`. Password
values supplied through `x-team-token` or `Authorization: Bearer` are not
accepted. Exact public report, guide, and contract reads remain available
without a session.

## Test-driven development record

1. RED: `node tests/protected-api-session.test.js`
   - Exit code: 1 (expected).
   - A request carrying only `x-team-token` received 200 from the staff data
     endpoint, proving the pre-change legacy-header vulnerability.
2. GREEN: `node tests/protected-api-session.test.js`
   - Exit code: 0.
   - Covers missing-session and legacy-header rejection, valid-cookie access,
     protected data reads/writes/deletes/guide issuance, both Naver proxies,
     and unauthenticated report/guide/contract reads.
3. Focused regression:
   - `node tests/client-guide-api.test.js`
   - `node tests/client-information-guide.test.js`
   - `node tests/naver-datalab.test.js`
   - All exited 0. Internal guide API tests now issue genuine signed cookies.
4. Full suite: `for f in tests/*.test.js; do node "$f" || exit 1; done`
   - Exit code: 0.
5. Diff validation: `git diff --check`
   - Exit code: 0.

## Files

- `api/data.js`
- `api/naver-keyword.js`
- `api/naver-datalab.js`
- `tests/client-information-guide.test.js`
- `tests/protected-api-session.test.js`

## Concerns

None. The implementation deliberately omits the optional legacy-header
migration path, so password-bearing headers cannot authorize these APIs.

## Review Round 1 Correction

The review identified five issues in the initial wiring. The follow-up commit
is recorded below.

- Public contract submission now merges only the fields that the public signing
  page actually exposes: business number, contact, email, signer name, and
  signature. Pricing, product, dates, terms, client identity, and staff-only
  fields remain from the stored record. The server owns submission timestamps.
- Both Naver proxies map upstream 401 and 403 responses to a generic 502, so
  an upstream credential failure cannot be confused with a dashboard session
  failure. Missing upstream credentials return generic 503 responses. Both
  non-POST responses include `Allow: POST`.
- `api/data.js` now dispatches public reads and unsupported methods before any
  dashboard-password configuration dependency. Storage misconfiguration is a
  generic 503 and no client error names infrastructure or environment settings.
- `tests/api-hardening-review.test.js` covers public-contract ownership,
  upstream credential semantics, generic error messages, and method headers.
  `tests/protected-api-session.test.js` now also covers valid-cookie protected
  POST, DELETE, and guide issuance plus legacy-header rejection for each.

Verification after the correction: `node tests/api-hardening-review.test.js`,
`node tests/protected-api-session.test.js`, the focused API and contract tests,
the complete `tests/*.test.js` loop, and `git diff --check` all exited 0.
