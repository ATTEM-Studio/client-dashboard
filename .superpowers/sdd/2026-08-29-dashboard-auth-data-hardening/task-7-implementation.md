# Task 7 implementation: CI, Security Headers, and Production Gate

## Delivered

- Added the `Dashboard Quality` GitHub Actions workflow for pushes to `main` and pull requests. It pins Node 20, checks every API file for syntax errors, and runs every `tests/*.test.js` file.
- Added `tests/security-regression.test.js`. It verifies that browser storage does not persist credential-named keys, `/api/auth` does not serialize password/session material, API sources do not use the retired `authToken` authorization path, and server API code has no raw console logging.
- Added a Vercel Content Security Policy with same-origin defaults, same-origin API connections, no plugins, a self-only base URI, same-origin framing, and exact SHA-256 pins for the inline scripts in `index.html` and `guide.html`.
- Kept the existing inline styles and data-URL contract signatures working through explicit `style-src` and `img-src` directives.
- Removed the raw `console.error(err)` catch-path log from `api/data.js`; responses remain generic and do not reveal upstream detail.
- Documented environment-variable names without values, the reproducible local command, and Preview/production smoke assertions in the README.

## TDD evidence

- `node tests/security-regression.test.js` initially failed because API source still contained a raw console error log and Vercel had no CSP.
- The same test passes after the header and logging changes. The test computes each inline-script hash from source, so a future inline script edit requires an explicit CSP update.

## Verification

- `node tests/security-regression.test.js`
- `for file in tests/*.test.js; do node "$file" || exit 1; done`
- `for file in api/*.js; do node --check "$file"; done`
- `git diff --check`

All completed successfully.

## Release follow-up

The repository has no package manifest or third-party runtime dependencies, so the CI runtime check intentionally uses the supported Node 20 runtime without an install step. Preview promotion and production smoke execution require the deployment URL and Vercel/GitHub access; they are documented in the README but were not performed from this worktree.
