# Task 2 Report: Client Weekend Setting

## Delivered

- Added the `f-exclude-weekends` checkbox to the client form.
- New clients save with weekend exclusion enabled by default.
- Existing clients missing the field render as unchecked and save as `false`.
- Saving an unchecked checkbox persists `excludeWeekends: false`.

## TDD evidence

- RED: focused persistence and markup tests failed because the setting did not exist.
- GREEN: both focused tests pass after the minimal form and save changes.

## Verification

- `node tests\\client-save-renewal-count.test.js`
- `node tests\\inline-script-syntax.test.js`
- `git diff --check`
