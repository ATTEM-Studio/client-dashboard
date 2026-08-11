# Renewal Cycle Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Monday-only cycle starts and a two-step renewal flow that resets the active cycle while preserving historic client data.

**Architecture:** Keep the current static `index.html` architecture and add narrowly scoped helpers for Monday validation, renewal defaults, cycle archiving, and checklist set application. Store historic checklist/progress snapshots on the client as `previousCycles`; keep reports, revenue, notes, and guide links untouched.

**Tech Stack:** Plain HTML/CSS/JavaScript in `index.html`, Node built-in tests under `tests/`, existing `/api/data` Redis persistence.

## Global Constraints

- New contract start dates must be Mondays.
- Renewal start defaults to the first Monday after the current contract end date.
- Renewal start can be edited, but only Mondays can be saved.
- Renewal processing must show a checklist set choice after date selection.
- Existing reports, revenue, daily notes, information guide links, and historic checklist records must be preserved.
- Active checklist and legacy progress reset for the new cycle.
- Selected checklist set generates fresh incomplete task copies and must not mutate the set.
- Weekend exclusion is out of scope for this phase.
- Contract-generation/signature work is out of scope for this phase.

---

### Task 1: Monday Date Helpers And Client Save Validation

**Files:**
- Modify: `index.html`
- Test: `tests/client-save-renewal-count.test.js`

**Interfaces:**
- Produces: `isMondayDate(value: string): boolean`
- Produces: `nextMondayAfter(value: string | null): string`
- Produces: `validateClientStartDate(client: object): string`

- [ ] **Step 1: Write failing tests for Monday validation**

Add assertions to `tests/client-save-renewal-count.test.js` that extract the new helper functions and verify:

```js
assert.strictEqual(sandbox.isMondayDate('2026-08-10'), true);
assert.strictEqual(sandbox.isMondayDate('2026-08-11'), false);
assert.strictEqual(sandbox.nextMondayAfter('2026-08-10'), '2026-08-17');
assert.strictEqual(sandbox.nextMondayAfter('2026-08-11'), '2026-08-17');
assert.strictEqual(sandbox.validateClientStartDate({ contractType: 'new', startDate: '2026-08-11' }), '신규 계약 시작일은 월요일만 선택할 수 있습니다.');
assert.strictEqual(sandbox.validateClientStartDate({ contractType: 'new', startDate: '2026-08-10' }), '');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
& 'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests\client-save-renewal-count.test.js
```

Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement date helpers and save validation**

In `index.html`, add helper functions near existing date helpers:

```js
function parseIsoDateParts(value){
  var match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||""));
  if(!match) return null;
  var y=Number(match[1]), m=Number(match[2]), d=Number(match[3]);
  var date=new Date(Date.UTC(y,m-1,d));
  if(date.getUTCFullYear()!==y || date.getUTCMonth()!==m-1 || date.getUTCDate()!==d) return null;
  return { y:y, m:m, d:d, date:date };
}
function isMondayDate(value){
  var parts=parseIsoDateParts(value);
  return !!parts && parts.date.getUTCDay()===1;
}
function isoFromUtcDate(date){
  return date.getUTCFullYear()+"-"+String(date.getUTCMonth()+1).padStart(2,"0")+"-"+String(date.getUTCDate()).padStart(2,"0");
}
function nextMondayAfter(value){
  var parts=parseIsoDateParts(value);
  var base=parts ? parts.date : new Date();
  var date=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth(),base.getUTCDate()));
  date.setUTCDate(date.getUTCDate()+1);
  while(date.getUTCDay()!==1) date.setUTCDate(date.getUTCDate()+1);
  return isoFromUtcDate(date);
}
function validateClientStartDate(client){
  if(client && client.contractType==="new" && client.startDate && !isMondayDate(client.startDate)){
    return "신규 계약 시작일은 월요일만 선택할 수 있습니다.";
  }
  return "";
}
```

Call `validateClientStartDate(data)` in the client save handler before `setS("client:"+data.id,data)`. If it returns text, call `showToast(message)`, set a custom validity on `f-start`, focus it, re-enable the save button, and return without saving.

- [ ] **Step 4: Run focused test to verify pass**

Run the same Node test. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add index.html tests/client-save-renewal-count.test.js
git commit -m "Validate Monday start dates"
```

---

### Task 2: Renewal Cycle Data Transformation

**Files:**
- Modify: `index.html`
- Test: `tests/calendar-status-and-contract-labels.test.js`

**Interfaces:**
- Consumes: `nextMondayAfter(value)`
- Produces: `contractEndDate(client: object): string`
- Produces: `buildRenewalClient(client: object, startDate: string, checklistSet: object | null): object`

- [ ] **Step 1: Write failing renewal transformation tests**

In `tests/calendar-status-and-contract-labels.test.js`, add tests that verify:

```js
const client = {
  id: 'client-1',
  contractType: 'new',
  renewalCount: 0,
  startDate: '2026-08-10',
  contractMonths: '1',
  checklist: [{ id: 'old-task', text: 'old', done: true }],
  progress: { '1': 'done' },
  dailyNotes: { '2026-08-11': 'note' },
  guideId: 'guide_keep',
  revenue: { weekly: 1000 }
};
const set = {
  id: 'set-1',
  name: 'Basic',
  items: [{ day: 1, text: 'new task' }, { week: '2', text: 'legacy week task' }]
};
const renewed = sandbox.buildRenewalClient(client, '2026-09-14', set);
assert.strictEqual(renewed.contractType, 'renewal');
assert.strictEqual(renewed.renewalCount, 1);
assert.strictEqual(renewed.startDate, '2026-09-14');
assert.deepStrictEqual(renewed.progress, {});
assert.strictEqual(renewed.dailyNotes['2026-08-11'], 'note');
assert.strictEqual(renewed.guideId, 'guide_keep');
assert.deepStrictEqual(renewed.revenue, { weekly: 1000 });
assert.strictEqual(renewed.previousCycles.length, 1);
assert.deepStrictEqual(renewed.previousCycles[0].checklist, [{ id: 'old-task', text: 'old', done: true }]);
assert.strictEqual(renewed.checklist.length, 2);
assert.strictEqual(renewed.checklist.every((task) => task.done === false), true);
assert.notStrictEqual(renewed.checklist[0].id, 'old-task');
```

Also test `buildRenewalClient(client, '2026-09-14', null)` creates `checklist: []`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
& 'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests\calendar-status-and-contract-labels.test.js
```

Expected: FAIL because `buildRenewalClient` does not exist.

- [ ] **Step 3: Implement transformation helpers**

In `index.html`, add:

```js
function contractEndDate(client){
  if(!client || !client.startDate) return "";
  var months=Math.max(1,Number(client.contractMonths||1));
  var parts=parseIsoDateParts(client.startDate);
  if(!parts) return "";
  var date=new Date(Date.UTC(parts.y,parts.m-1,parts.d));
  date.setUTCMonth(date.getUTCMonth()+months);
  date.setUTCDate(date.getUTCDate()-1);
  return isoFromUtcDate(date);
}
function checklistTasksFromSet(set){
  var items=set&&Array.isArray(set.items)?set.items:[];
  return items.map(function(item){
    return {
      id:uid("task"),
      text:String(item.text||""),
      done:false,
      day:item.day ? Number(item.day) : undefined,
      week:item.week ? String(item.week) : ""
    };
  }).filter(function(task){ return task.text.trim(); });
}
function buildRenewalClient(client,startDate,checklistSet){
  var currentCount=client&&client.contractType==="renewal"?Math.max(1,Number(client.renewalCount||1)):0;
  var archived=(client.previousCycles||[]).slice();
  archived.push({
    cycleNumber:currentCount+1,
    contractType:client.contractType||"new",
    startDate:client.startDate||"",
    contractMonths:client.contractMonths||"",
    checklist:JSON.parse(JSON.stringify(client.checklist||[])),
    progress:JSON.parse(JSON.stringify(client.progress||{})),
    archivedAt:Date.now()
  });
  var next=Object.assign({},client);
  next.contractType="renewal";
  next.renewalCount=currentCount+1;
  next.startDate=startDate;
  next.previousCycles=archived;
  next.checklist=checklistSet ? checklistTasksFromSet(checklistSet) : [];
  next.progress={};
  return next;
}
```

- [ ] **Step 4: Run focused test to verify pass**

Run the same test. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add index.html tests/calendar-status-and-contract-labels.test.js
git commit -m "Add renewal cycle transformation"
```

---

### Task 3: Two-Step Renewal Modal

**Files:**
- Modify: `index.html`
- Test: `tests/inline-script-syntax.test.js`
- Test: `tests/calendar-status-and-contract-labels.test.js`

**Interfaces:**
- Consumes: `contractEndDate(client)`
- Consumes: `nextMondayAfter(value)`
- Consumes: `buildRenewalClient(client,startDate,checklistSet)`
- Produces: `renewalDialog(client: object): void`
- Replaces: `markRenewal(id)` confirm-only behavior with modal-driven behavior.

- [ ] **Step 1: Write failing modal markup and behavior tests**

In `tests/inline-script-syntax.test.js`, assert the source contains:

```js
assert.match(html, /id="renewal-modal"/);
assert.match(html, /id="renewal-start-date"/);
assert.match(html, /data-renewal-set=/);
assert.match(html, /세트 없이 시작/);
```

In `tests/calendar-status-and-contract-labels.test.js`, update the existing `markRenewal` test to expect that direct renewal uses `buildRenewalClient` and preserves the new cycle reset behavior.

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
& 'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests\inline-script-syntax.test.js
& 'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests\calendar-status-and-contract-labels.test.js
```

Expected: FAIL because renewal modal controls are missing.

- [ ] **Step 3: Implement modal rendering**

Add a renewal modal section or reuse the existing modal layer with a custom renewal body. The rendered UI must include:

- Date input `id="renewal-start-date"`
- Checklist set options with `data-renewal-set="<set id>"`
- A no-set option with `data-renewal-set=""`
- Final button `id="btn-confirm-renewal"`

Default date:

```js
var defaultDate=nextMondayAfter(contractEndDate(client)||isoDate(new Date()));
```

Set date input value to `defaultDate`.

- [ ] **Step 4: Implement save flow**

On final confirmation:

```js
var startDate=document.getElementById("renewal-start-date").value;
if(!isMondayDate(startDate)){
  showToast("재계약 시작일은 월요일만 선택할 수 있습니다.");
  return;
}
var selectedSetId=state.renewalSelectedSetId||"";
var selectedSet=selectedSetId ? state.checklistSets.find(function(set){ return set.id===selectedSetId; }) : null;
var renewed=buildRenewalClient(client,startDate,selectedSet);
var saved=await setS("client:"+client.id,renewed);
if(!saved){ showToast("재계약 저장에 실패했습니다"); return; }
state.currentClient=renewed;
state.clients=state.clients.map(function(item){ return item.id===renewed.id?renewed:item; });
await setP("clients-index",state.clients);
renderClientWorkspace(renewed);
```

Keep the modal open on save failure.

- [ ] **Step 5: Run focused tests**

Run both focused tests. Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add index.html tests/inline-script-syntax.test.js tests/calendar-status-and-contract-labels.test.js
git commit -m "Add renewal checklist set flow"
```

---

### Task 4: Full Regression And Production Readiness

**Files:**
- Modify only if tests reveal defects in the prior tasks.
- Test: all files under `tests/`

**Interfaces:**
- Consumes all helpers and UI flows from Tasks 1-3.
- Produces a deployable main branch state.

- [ ] **Step 1: Run the full suite**

Run:

```powershell
$node='C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
Get-ChildItem tests -Filter *.test.js | Sort-Object Name | ForEach-Object { & $node $_.FullName; if($LASTEXITCODE -ne 0){ exit $LASTEXITCODE } }
& $node --check api\data.js
git diff --check
```

Expected: exit 0.

- [ ] **Step 2: Fix only defects found by tests**

If a test fails, reproduce the focused failing test, fix the smallest cause, and rerun the focused test before rerunning the full suite.

- [ ] **Step 3: Verify release checklist manually or with browser**

Check:

- Existing client detail page opens.
- New client with Monday start can save.
- New client with non-Monday start cannot save.
- Renewal modal opens from `재계약 처리`.
- Default renewal date is Monday.
- Checklist set can be selected.
- After renewal, progress is reset and checklist comes from selected set.

- [ ] **Step 4: Commit repairs if any**

```powershell
git add index.html tests
git commit -m "Stabilize renewal cycle foundation"
```

Only commit if Step 2 changed files.

---

## Self-Review Notes

- Spec coverage: Monday validation, renewal default date, checklist set choice, cycle archive, active reset, and preservation of existing guide/revenue/report/note data are covered.
- Scope intentionally excludes weekend exclusion, contract generation/signature, and full revenue-history redesign.
- The plan uses existing single-file architecture and existing Node test style.
- No new external dependencies are introduced.

