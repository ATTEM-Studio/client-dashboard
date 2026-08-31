# Task 6 implementation: Duplicate-Action and Payload Guards

## Delivered

- Added `withPendingAction(key, action)` to coalesce in-flight browser mutations.
- Guarded public contract submission, public guide submission, renewal confirmation, and client deletion with stable document-specific keys.
- Disabled contract and renewal initiating controls for the duration of their shared action and restored them after settlement.
- Added a 2 MB JSON request guard, strict object/type checks, and document-specific collection limits for clients, reports, and checklist sets.
- Limited public signatures to 1.5 MB while allowing authenticated contract documents to retain valid signatures up to that limit.
- Whitelisted public guide answer fields before the Redis mutation; unexpected fields are dropped.
- Made repeated public contract submissions idempotent: an already-submitted contract is returned without another write.
- Preserved existing public guide/report response allowlists and legacy public-read behavior.

## Test coverage

`tests/request-guards.test.js` covers:

- Concurrent guide and contract actions sharing one Promise.
- Retry after action settlement.
- Bodies over 2 MB, malformed guide answers, and signatures over 1.5 MB.
- Over-200 client checklist entries and ignored unexpected public guide fields.
- Retried public contract submission returning the signed document without a second write.

## Verification

- `node tests/request-guards.test.js`
- `node tests/contract-management.test.js`
- `node tests/client-information-guide.test.js`
- `node tests/calendar-status-and-contract-labels.test.js`
- `node tests/inline-script-syntax.test.js`
- `for f in tests/*.test.js; do node "$f" || exit 1; done`
- `git diff --check`

## Review round 1 follow-up

- Public contract submission now commits the contract, linked client, and both indexes in one Redis Lua transaction, with a persistent idempotency marker. A retry also repairs legacy partial submissions because it reconciles all downstream documents before returning.
- Public guide submission stores an atomic Redis idempotency result; the browser keeps one generated key across a retry and creates a new key when the customer explicitly edits after completion.
- Renewal persistence uses an atomic client/index Redis transaction and a stable renewal-specific idempotency key.
- Raw JSON is measured before parsing in both data endpoints, so whitespace and ignored properties count toward the 2 MB limit.
- Stored-guide shape, report nested `next` lists, index documents, checklist/task identities, and report metric shapes are validated explicitly.
- Report and client deletes now preserve in-memory state on failure, display retryable errors, and both destructive paths use pending-action guards.

## Review round 2 follow-up

- Contract index upserts now use a single capped helper. Both client and contract indexes are checked before a submit `EVAL` is sent; the 201st entry is rejected without a write.
- Report and client deletion now use atomic Redis Lua mutations that delete documents and replace affected indexes as one transaction. Legacy direct client/report `DELETE` calls are rejected.
- Added executable tests for 201-entry boundaries, concurrent renewal idempotency, raw-body limits, and failed report deletion state preservation alongside the earlier contract concurrency/recovery test.
