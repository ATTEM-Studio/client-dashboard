# Browser Demo Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a password-free, browser-persistent demo workspace that exercises the dashboard without accessing production data or live external APIs.

**Architecture:** Keep the existing single-page dashboard and introduce a mode-aware storage boundary. Staff mode continues to use authenticated API transports, while demo mode reads and writes a versioned `localStorage` workspace seeded with three fictional clients; external links and Naver API calls are replaced by clearly labeled simulations.

**Tech Stack:** Static HTML/CSS/vanilla JavaScript, browser `localStorage`, existing Vercel Functions, Node.js assertion tests, Vercel Git deployment.

## Global Constraints

- The existing team-password login and Redis-backed staff workspace must remain unchanged.
- Demo mode must never read or write production Redis keys, send a team token, issue public links, or call Naver APIs.
- Demo edits persist only in the current browser and can be reset to immutable seed data.
- Demo contains three fictional client states: new start-soon, active second week, and fourth-week renewal season.
- External contract and information-guide workflows are simulated and visibly labeled as demo behavior.
- Analyzer results use prepared sample data and state that they are not actual Naver figures.
- Existing Toss-style UI, active motion tokens, reduced-motion behavior, and 390px mobile support remain intact.
- Do not copy any real customer name, answer, signature, contact detail, or metric into seed data.

---

### Task 1: Versioned Demo Workspace and Storage Boundary

**Files:**
- Create: `demo-data.js`
- Modify: `index.html` storage helpers around `getS`, `setS`, `getP`, and `setP`
- Test: `tests/browser-demo-mode.test.js`

**Interfaces:**
- Produces: `DEMO_STORAGE_KEY`, `DEMO_SCHEMA_VERSION`, `createDemoSeed(now)`, `loadDemoWorkspace(storage, now)`, `saveDemoValue(storage, key, value)`, and `resetDemoWorkspace(storage, now)`.
- Consumes: Existing workspace keys `clients-index`, `reports-index`, `contracts-index`, `contract-base-terms-template`, and `checklist-sets`.

- [ ] **Step 1: Write failing storage and seed tests**

Create `tests/browser-demo-mode.test.js` using `assert`, `fs`, and `vm`. Load `demo-data.js` into a sandbox with a fake storage object and assert:

```js
const seed = sandbox.createDemoSeed(new Date('2026-08-17T00:00:00+09:00'));
assert.strictEqual(seed.version, 1);
assert.strictEqual(seed.values['clients-index'].length, 3);
assert.deepStrictEqual(
  seed.values['clients-index'].map((client) => client.demoStage),
  ['upcoming', 'active-week-2', 'renewal-week-4']
);

const loaded = sandbox.loadDemoWorkspace(storage, new Date('2026-08-17T00:00:00+09:00'));
sandbox.saveDemoValue(storage, 'reports-index', [{ id: 'demo-report-edit' }]);
assert.strictEqual(
  sandbox.loadDemoWorkspace(storage, new Date('2026-08-17T00:00:00+09:00')).values['reports-index'][0].id,
  'demo-report-edit'
);
sandbox.resetDemoWorkspace(storage, new Date('2026-08-17T00:00:00+09:00'));
assert.notStrictEqual(sandbox.loadDemoWorkspace(storage, new Date()).values['reports-index'][0]?.id, 'demo-report-edit');
```

Also assert that corrupt JSON is replaced by a valid seed and storage exceptions return an in-memory workspace with `persistent:false`.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```powershell
& 'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests/browser-demo-mode.test.js
```

Expected: FAIL because `demo-data.js` and the exported demo helpers do not exist.

- [ ] **Step 3: Implement immutable relative-date seed data**

Create `demo-data.js` as a browser and Node-compatible IIFE. Use `structuredClone` when available and JSON cloning otherwise. Derive all dates from local calendar-day helpers instead of elapsed milliseconds.

```js
(function (root) {
  var DEMO_STORAGE_KEY = 'rs:browser-demo-workspace:v1';
  var DEMO_SCHEMA_VERSION = 1;
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function createDemoSeed(now) {
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return {
      version: DEMO_SCHEMA_VERSION,
      seededAt: today.toISOString(),
      values: {
        'clients-index': buildDemoClients(today),
        'reports-index': buildDemoReports(today),
        'contracts-index': buildDemoContracts(today),
        'contract-base-terms-template': '',
        'checklist-sets': buildDemoChecklistSets()
      }
    };
  }
  root.DemoData = { DEMO_STORAGE_KEY, DEMO_SCHEMA_VERSION, createDemoSeed, loadDemoWorkspace, saveDemoValue, resetDemoWorkspace };
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

Populate the three clients and supporting records with fictional Korean business names, weekday checklist tasks, reports, revenue, ad metrics, demo contract state, and demo guide state. Mark every record with `demo:true`.

- [ ] **Step 4: Route existing storage helpers through the active mode**

Load `demo-data.js` before the main inline script. Add `workspaceMode`, `demoWorkspace`, and these exact mode helpers in `index.html`:

```js
var workspaceMode = sessionStorage.getItem('rs:workspace-mode') === 'demo' ? 'demo' : 'staff';
var demoWorkspace = null;
function isDemoMode(){ return workspaceMode === 'demo'; }
function ensureDemoWorkspace(){
  if (!demoWorkspace) demoWorkspace = DemoData.loadDemoWorkspace(localStorage, new Date());
  return demoWorkspace;
}
```

At the start of `getS`/`getP`, return a cloned demo value when `isDemoMode()`. At the start of `setS`/`setP`, update `DemoData.saveDemoValue` and return success without calling `fetch`. Keep the staff branches byte-for-byte equivalent in behavior.

- [ ] **Step 5: Run focused and storage regression tests**

Run the new demo test plus `client-save-renewal-count.test.js`, `calendar-checklist-sets.test.js`, `revenue-reporting.test.js`, and direct inline-script compilation. Expected: demo tests PASS and no new staff storage failure.

- [ ] **Step 6: Commit Task 1**

```powershell
git add demo-data.js index.html tests/browser-demo-mode.test.js
git commit -m "Add isolated browser demo storage"
```

---

### Task 2: Password-Free Demo Entry, Mode Chrome, and Reset

**Files:**
- Modify: `index.html` login renderer, dashboard header/menu, initialization, and logout flow
- Test: `tests/browser-demo-mode.test.js`

**Interfaces:**
- Consumes: `isDemoMode()`, `ensureDemoWorkspace()`, and `DemoData.resetDemoWorkspace` from Task 1.
- Produces: `enterDemoMode()`, `leaveDemoMode()`, `resetDemoMode()`, and visible `DEMO` status UI.

- [ ] **Step 1: Add failing source and behavioral tests**

Assert the login renderer contains `id="btn-enter-demo"`, explanatory copy, and a click path that does not invoke `/api/auth`. In a VM harness, call `enterDemoMode()` with a fetch spy and assert `fetchCalls.length === 0`, `workspaceMode === 'demo'`, and `state.view === 'dashboard'` after loading.

Assert dashboard markup in demo mode contains `DEMO`, `데모 초기화`, and `운영 로그인으로 전환`, while staff mode does not show the demo badge.

- [ ] **Step 2: Run the focused test and verify RED**

Expected failures: demo entry button and mode actions are absent.

- [ ] **Step 3: Implement login and mode transitions**

Add a divider and secondary demo button to `renderLogin()`. Implement:

```js
async function enterDemoMode(){
  workspaceMode = 'demo';
  sessionStorage.setItem('rs:workspace-mode', 'demo');
  authToken = null;
  ensureDemoWorkspace();
  await loadWorkspace();
}
function leaveDemoMode(){
  workspaceMode = 'staff';
  sessionStorage.removeItem('rs:workspace-mode');
  demoWorkspace = null;
  state.view = 'login';
  renderLogin();
}
async function resetDemoMode(){
  if (!isDemoMode()) return;
  demoWorkspace = DemoData.resetDemoWorkspace(localStorage, new Date());
  await loadWorkspace();
  showToast('데모 데이터가 처음 상태로 초기화되었습니다.');
}
```

Initialization must enter demo directly only when the session flag is `demo`; otherwise preserve the existing public guide/contract/report routing and staff authentication logic.

- [ ] **Step 4: Add demo chrome and recovery notices**

Add a compact `DEMO` badge beside the dashboard brand. Add reset and staff-login actions to the existing animated menu. Show a one-time toast when `ensureDemoWorkspace().recovered === true` and a persistent hint when `persistent === false`.

- [ ] **Step 5: Verify entry, refresh, reset, and staff switch**

Run the focused demo test, active-motion test, inline compilation, and login/auth API tests. Confirm reset requires the existing confirmation UI and never removes `AUTH_KEY` unless the user explicitly uses staff logout.

- [ ] **Step 6: Commit Task 2**

```powershell
git add index.html tests/browser-demo-mode.test.js
git commit -m "Add password-free demo entry"
```

---

### Task 3: Simulated External Workflows and Sample Analyzer

**Files:**
- Modify: `demo-data.js`
- Modify: `index.html` contract, guide, PDF/link actions, and analyzer fetch paths
- Test: `tests/browser-demo-mode.test.js`
- Test: `tests/naver-datalab.test.js`

**Interfaces:**
- Consumes: `isDemoMode()` and the versioned demo document.
- Produces: `demoKeywordResponse(mode, keywords)`, `demoDataLabResponse(keyword, unit, startDate, endDate)`, and `guardDemoExternalAction(action)`.

- [ ] **Step 1: Add failing external-isolation tests**

Use a fetch spy and exercise demo contract issuance, guide issuance, keyword volume, related lookup, bulk lookup, and trend lookup. Assert no URL begins with `/api/guide`, no contract reservation mutation occurs, and no URL equals `/api/naver-keyword` or `/api/naver-datalab`.

Assert the analyzer exposes sample modes for `강남맛집`, `서면맛집`, and `카페마케팅`, returns deterministic table/chart values, and labels them `데모 데이터 · 실제 네이버 수치가 아닙니다.`

- [ ] **Step 2: Run focused tests and verify RED**

Expected: live endpoint calls are observed and sample helpers are absent.

- [ ] **Step 3: Implement simulated contract and guide actions**

Before every public-link issuance call, branch on `isDemoMode()`. In demo mode update only the relevant browser record, create a non-routable display identifier such as `demo-contract-preview`, and show:

```js
showToast('데모에서는 외부 링크가 발급되지 않습니다.');
```

Demo sign/submit actions persist signer, timestamp, and result state locally. PDF/print output adds a visible `DEMO DOCUMENT` mark and never contains a production-capable public URL.

- [ ] **Step 4: Implement prepared analyzer responses**

Add exact-key sample records in `demo-data.js`. The keyword volume, related keyword, and bulk modes reuse current table/chart renderers with sample payloads. Unsupported keywords render the available keyword list without fabricating live-looking results.

In demo mode change API cards to `샘플 데이터`, hide quota claims, and bypass both Naver fetches. Staff mode retains the existing live fetch path unchanged.

- [ ] **Step 5: Run analyzer, contract, guide, and demo tests**

Run `browser-demo-mode.test.js`, `naver-datalab.test.js`, `contract-management.test.js`, and `client-information-guide.test.js`, followed by direct inline compilation. Expected: demo endpoint isolation assertions pass and staff API assertions remain unchanged.

- [ ] **Step 6: Commit Task 3**

```powershell
git add demo-data.js index.html tests/browser-demo-mode.test.js tests/naver-datalab.test.js
git commit -m "Simulate demo links and analyzer data"
```

---

### Task 4: End-to-End Regression, Responsive Verification, and Release

**Files:**
- Modify only if verification exposes a scoped defect: `index.html`, `demo-data.js`, or relevant tests
- Create: `.superpowers/sdd/2026-08-14-browser-demo-mode/task-4-report.md`

**Interfaces:**
- Consumes: Complete demo mode from Tasks 1–3.
- Produces: Verified Git commit on `main` and a confirmed production deployment.

- [ ] **Step 1: Run the complete test inventory**

Run every `tests/*.test.js` file with the bundled Node executable, compile all inline scripts with `vm.Script`, and run `git diff --check`. Record every command, exit code, pass count, and any established harness-only failure in the report. New demo, auth, storage, contract, guide, analyzer, calendar, checklist, report, and motion tests must be green.

- [ ] **Step 2: Verify staff-mode invariants**

On a local Vercel environment or protected preview, log in with the existing team password and confirm the production workspace count and records are unchanged. Create no production records during this check. Verify staff analyzer cards still use live API status and that the demo badge is absent.

- [ ] **Step 3: Verify demo desktop flows**

Using browser automation, enter without a password and confirm:

- Three fictional clients render in the intended stages.
- A checklist completion and daily note survive reload.
- Weekly/monthly reports and revenue edits update charts.
- Simulated contract/guide actions show the demo notice and persist locally.
- All three analyzer tabs render prepared data without network calls.
- Reset restores the original seed.
- Switching to staff login returns to the password screen.

- [ ] **Step 4: Verify 390px mobile and reduced motion**

Set the browser viewport to `390x844`. Confirm no horizontal overflow, menu actions remain reachable, modals fit the viewport, and reset confirmation is usable. Enable reduced motion and confirm spatial transitions are replaced by immediate/fade behavior.

- [ ] **Step 5: Request final code review**

Provide the reviewer the design document, this plan, base SHA, head SHA, and the Task 4 report. Resolve all Critical and Important findings and re-run the affected checks.

- [ ] **Step 6: Merge, push, and verify Vercel production**

After approval, integrate to `main`, run the focused release suite on the merged tree, push `main`, and poll `https://clientdashboard-one.vercel.app/` until the deployed source contains the demo entry marker. Re-run the password-free demo entry and staff-login-screen checks on production.

- [ ] **Step 7: Commit verification artifacts if changed**

```powershell
git add .superpowers/sdd/2026-08-14-browser-demo-mode/task-4-report.md
git commit -m "Document browser demo verification"
```
