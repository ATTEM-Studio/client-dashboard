# Task 5 Implementation: Strong Report IDs and Public Response Whitelists

## Delivered

- Added `publicId(prefix)` in `index.html`. New reports now use a 24-byte
  `crypto.getRandomValues` token (`rpt_` plus 48 hexadecimal characters).
  Existing report IDs remain unchanged when an existing report is edited.
- Added explicit public-report serialization in `api/data.js`. It returns only
  fields used by the report renderer, recursively copies permitted scalar and
  nested values, and bounds public strings, lists, channels, and metrics.
- Kept every `report:<id>` key publicly readable, so timestamp/random legacy
  report links continue to resolve without an ID migration.
- Tightened the existing public guide and contract serializers so allowed
  fields cannot carry nested objects, non-finite numbers, or oversized strings.
  Their field names and normal string/number response contracts are preserved.
- Added `tests/public-document-security.test.js`; updated the report save
  sandbox in `tests/revenue-reporting.test.js` for the new ID helper.

## TDD evidence

`node tests/public-document-security.test.js` initially failed because
`publicId` did not exist, public reports returned their stored value verbatim,
and guide answers could contain nested objects. It passes after the
implementation.

## Verification

Executed successfully:

```bash
node tests/public-document-security.test.js
node tests/revenue-reporting.test.js
node tests/contract-management.test.js
node tests/client-information-guide.test.js
node tests/client-guide-api.test.js
git diff --check
node --check api/data.js
node --check tests/public-document-security.test.js
for f in tests/*.test.js; do node "$f" || exit 1; done
```

All focused tests and the complete `tests/*.test.js` suite exited 0.

## Follow-up: authenticated document reads

- Fixed the GET response path so the public serializers apply only to
  unauthenticated requests. A valid signed staff session now receives the
  stored `report:`, high-entropy `guide:`, and high-entropy `contract:` value
  verbatim, including staff-only fields.
- Public requests continue through the explicit report, guide, and contract
  allowlist serializers, so private fields remain omitted from share links.
- Added a signed-cookie regression in `tests/public-document-security.test.js`
  covering both sides of this boundary for all three document types.

### Follow-up TDD evidence

`node tests/public-document-security.test.js` first failed because an
authenticated report response omitted `internalMemo`; the same unconditional
serializer branch affected guides and contracts. It passes after the GET
branch uses the authenticated request state to select either the internal raw
value or the public serializer.

### Follow-up verification

Executed successfully:

```bash
node tests/public-document-security.test.js
node tests/protected-api-session.test.js
node tests/client-information-guide.test.js
node tests/contract-management.test.js
node tests/revenue-reporting.test.js
node --check api/data.js
node --check tests/public-document-security.test.js
git diff --check
for f in tests/*.test.js; do node "$f" || exit 1; done
```
