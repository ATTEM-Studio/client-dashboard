# Task 4 implementation — browser credential removal

## Delivered

- Removed the browser `rs:team-token` storage/read/write path and all legacy token/Bearer request headers.
- Changed staff login to accept only the server cookie-session success payload (`{ ok: true }`) and explicitly send same-origin cookies.
- Routed staff data, contract, guide, and Naver requests through cookie-aware transports. A 401 snapshots the visible form fields, shows a session-expiry login state, and restores the snapshot after successful login.
- Changed logout to POST `/api/auth?action=logout` before returning to the staff login view.
- Kept demo mode isolated: it enters local workspace state before any API route is considered, uses local keyword data, and the test checks zero staff/guide/Naver calls at entry.

## Test coverage

`tests/browser-session-flow.test.js` provides a source/VM flow for login → protected data fetch → server logout, asserting same-origin cookies and no password-token headers. `tests/browser-demo-mode.test.js` additionally checks that demo entry has no API calls.

## Verification

- Focused session/demo/syntax tests passed.
- Every `tests/*.test.js` test passed.
- `git diff --check` passed.

## Scope note

Public customer guide mutation remains a deliberately unauthenticated public endpoint; staff-only requests use the cookie session transport.

## Review round 1

- Added a distinct `session_expired` error, request generation checks, and an idempotent first-401 transition so stale protected requests cannot repaint the application after login is shown.
- Session draft capture is memory-only and now includes report/channel/metric rows, id-less controls by stable position, select/checkbox/contenteditable values, button-backed selections, and contract signature canvas data.
- Demo entry clears the staff draft and invalidates staff work before its local workspace loads; demo loads never restore a staff snapshot.
- Server logout now requires a successful response before changing the authenticated view, and duplicate login submissions share a single in-flight operation.
- Expanded the browser VM test for error propagation, concurrent expiry, stale render suppression, complex draft restoration, demo isolation, failed logout, and duplicate login.

## Review round 2

- Staff transports now classify an out-of-generation response before inspecting its status. A deferred 401 from an old request therefore raises `stale_session_request` and cannot expire a newly re-authenticated cookie session.
- Session expiry now snapshots and removes the protected renewal and daily-note body overlays before rendering login. The snapshot includes the renewal date, checklist-set selection and step, plus the daily-note client/date/note state; successful staff re-login rebuilds those overlays through their normal open functions, while demo mode never restores them.
- The session VM test now deterministically covers the late-401 race and expiry/re-login overlay capture, removal, restoration, selection handler replay, and demo isolation.

## Review round 3

- Added the shared `isSessionControlError` classifier for both `session_expired` and `stale_session_request`. All staff storage adapters (`readS`, `getP`, `setP`, `getS`, `setS`, `delS`, and guide reservation) and public storage wrappers now rethrow those control-flow errors instead of returning null, error records, or failed-save results.
- Client snapshot persistence now receives stale write failures directly, so an expired generation cannot start its generic rollback path or any follow-on storage write.
- Expanded the browser VM test to pass both control errors through every named adapter, public-save wrapper, and a stale client-index persist failure, asserting exact propagation and no rollback write.
