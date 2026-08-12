# Client Guide Dedicated API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep existing permanent information-guide links working while moving guide reads, autosaves, submissions, and admin reads onto a dedicated API flow.

**Architecture:** Add `api/guide.js` as the single guide boundary. It reads legacy `guide:`/`guide-issue:` records for compatibility, writes public guide data atomically, and keeps `guide-review:` private. Update `index.html` to call this API for public and admin guide flows, with session recovery and typed retry states.

**Tech Stack:** Vercel serverless JavaScript, Upstash Redis REST/EVAL, static HTML/vanilla JavaScript, Node built-in test runner.

## Global Constraints

- Preserve every existing `?guide=guide_...` URL.
- Public responses never include internal review status or memo.
- Public answer fields remain limited to the existing 13 fields.
- Do not change contract, checklist, report, or revenue behavior.
- Keep existing untracked planning artifacts untouched.
- Use RED→GREEN tests before production edits.

### Task 1: Define dedicated guide API contract and compatibility helpers

**Files:**
- Create: `api/guide.js`
- Test: `tests/client-guide-api.test.js`
- Modify: `tests/inline-script-syntax.test.js` only if the new API helper needs a syntax assertion

**Interfaces:**
- `GET /api/guide?id=<guideId>` returns `{ guide }` with public fields only.
- `POST /api/guide?id=<guideId>&action=save|submit` accepts `{ answers }` and returns `{ guide }`.
- `api/guide.js` exports the Vercel `(req,res)` handler.

- [ ] **Step 1: Write failing API tests** for legacy guide GET, public-field redaction, save, submit, invalid IDs, missing records, and internal review exclusion.
- [ ] **Step 2: Run `node tests/client-guide-api.test.js`** and confirm failures are caused by the missing endpoint.
- [ ] **Step 3: Implement `api/guide.js`** by extracting the existing guide validation/allowlist rules, reading `guide:<id>` and `guide-issue:<clientId>`, and using one atomic Redis script for save/submit. Preserve monotonic `submittedAt`, server timestamps, and answer-field allowlists.
- [ ] **Step 4: Run the focused test and `node --check api/guide.js`**; confirm all API cases pass.
- [ ] **Step 5: Commit** `Add dedicated client guide API`.

### Task 2: Route public guide UI through the dedicated API

**Files:**
- Modify: `index.html` in `storageBackend`, public guide read/mutate helpers, and public guide lifecycle functions
- Test: `tests/client-information-guide.test.js`

**Interfaces:**
- Add `storageBackend.guideGet(guideId)`, `guideSave(guideId,answers)`, and `guideSubmit(guideId,answers)`.
- Existing public functions `readS`, `mutatePublicGuide`, and `loadPublicGuidePage` continue to work for non-guide storage and use the dedicated methods for guide flows.

- [ ] **Step 1: Add failing tests** proving public guide GET/save/submit requests target `/api/guide`, preserve the same ID, and display typed retry state for a 503/connection error.
- [ ] **Step 2: Run focused tests** and confirm they fail against the current `/api/data` route.
- [ ] **Step 3: Implement the dedicated client methods** with `Cache-Control: no-store`, JSON parsing, explicit `missing`, `retryable`, and `invalid` statuses, and no auth header requirement for public guide calls.
- [ ] **Step 4: Update autosave/submit sequencing** to call the dedicated methods while retaining the existing 500ms queue, submit race protection, and edit-after-submit behavior.
- [ ] **Step 5: Add sessionStorage recovery** keyed by guide ID: write the latest successful answer snapshot, restore it only when the server read is unavailable, and replace it after a successful server response.
- [ ] **Step 6: Run focused guide tests plus inline syntax** and commit `Route public guide through dedicated API`.

### Task 3: Route admin guide tab and review persistence through the dedicated API

**Files:**
- Modify: `index.html` in `informationGuidePanel`, `issueGuideForClient`, `selectClientWorkspaceTab`, and `saveGuideReview`
- Test: `tests/client-information-guide.test.js`

**Interfaces:**
- Admin public-document reads use `GET /api/guide?id=...` with the existing team token.
- Review writes remain authenticated and use `guide-review:<id>` through the existing protected data path.

- [ ] **Step 1: Add failing tests** for repeated tab entry, missing client `guideId` recovery, stale public read handling, and review data never being sent through the public endpoint.
- [ ] **Step 2: Run the focused tests** and confirm failures against the current mixed storage flow.
- [ ] **Step 3: Update admin guide loading** to use the dedicated guide GET, keep the link visible during loading/errors, and show a retry action without deleting `guideId`.
- [ ] **Step 4: Keep review reads/writes separate** and prevent a failed review request from replacing a valid public guide document.
- [ ] **Step 5: Run focused guide tests and calendar/checklist regression tests**, then commit `Stabilize admin guide tab persistence`.

### Task 4: Full verification, deployment, and production smoke check

**Files:**
- Modify: none unless verification exposes a scoped defect
- Test: all files in `tests/*.test.js`

- [ ] **Step 1: Run every test file with the bundled Node runtime**, `node --check api/data.js`, `node --check api/guide.js`, and `git diff --check`.
- [ ] **Step 2: Start the local Vercel server** and verify HTTP 200 for the dashboard and typed 404/401 behavior for malformed guide/API requests.
- [ ] **Step 3: Review the diff** to confirm only the dedicated guide work and tests are included.
- [ ] **Step 4: Push `main` to GitHub** with the verified commits.
- [ ] **Step 5: Deploy to Vercel production** and verify the aliased production URL serves the new guide markers and API route.
- [ ] **Step 6: Record the deployment URL and any environment limitation** in the final handoff.
