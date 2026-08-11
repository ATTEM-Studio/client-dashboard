# Calendar Workday Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the schedule calendar so new clients default to weekday-based cycles while existing clients keep legacy behavior.

**Architecture:** Keep the existing `index.html` single-file app and add helper functions that select either calendar-day or workday ordinals per client. Calendar rendering will add classes for weekends, outside-cycle dates, and ended-cycle dates without removing click access.

**Tech Stack:** Plain HTML/CSS/JavaScript in `index.html`, Node built-in tests under `tests/`, existing Redis API unchanged.

## Global Constraints

- Add client field `excludeWeekends`.
- New clients default `excludeWeekends` to `true`.
- Existing clients without `excludeWeekends` are treated as `false`.
- When `excludeWeekends === true`, Saturday and Sunday do not increment checklist day ordinal.
- When `excludeWeekends === true`, 1주차 is workdays 1-5, 2주차 is workdays 6-10, 3주차 is workdays 11-15, 4주차 is workdays 16-20, and 마무리 is workdays 21-22.
- When `excludeWeekends !== true`, existing 30-calendar-day behavior remains.
- Weekend cells remain visible.
- Out-of-cycle and ended-cycle dates use muted gray visual treatment.
- Unfinished red outline remains visible.
- Clicking muted dates remains allowed.
- Do not implement checklist accordion redesign, revenue history redesign, home dashboard redesign, or contract generation/signature.

---

### Task 1: Workday Ordinal Helpers

**Files:**
- Modify: `index.html`
- Test: `tests/calendar-checklist-sets.test.js`
- Test: `tests/calendar-navigation.test.js`

**Interfaces:**
- Produces: `isWeekendDate(dateKey: string): boolean`
- Produces: `workdayOrdinal(startDate: string, dateKey: string): number | null`
- Produces: `cycleDayOrdinal(client: object, dateKey: string): number | null`
- Updates: `checklistPeriod` and `calendarTasksForDate` to accept either legacy `(startDate,dateKey,...)` or client-aware usage without breaking existing callers.

- [ ] **Step 1: Write failing helper tests**

In `tests/calendar-checklist-sets.test.js`, add:

```js
assert.strictEqual(sandbox.isWeekendDate('2026-08-15'), true);
assert.strictEqual(sandbox.isWeekendDate('2026-08-17'), false);
assert.strictEqual(sandbox.workdayOrdinal('2026-08-10', '2026-08-10'), 1);
assert.strictEqual(sandbox.workdayOrdinal('2026-08-10', '2026-08-14'), 5);
assert.strictEqual(sandbox.workdayOrdinal('2026-08-10', '2026-08-15'), null);
assert.strictEqual(sandbox.workdayOrdinal('2026-08-10', '2026-08-17'), 6);
assert.strictEqual(sandbox.cycleDayOrdinal({ startDate:'2026-08-10', excludeWeekends:true }, '2026-08-17'), 6);
assert.strictEqual(sandbox.cycleDayOrdinal({ startDate:'2026-08-10' }, '2026-08-17'), 8);
```

In `tests/calendar-navigation.test.js`, add that day-6 task appears on next Monday when `excludeWeekends:true`, and day-6 task still appears on Saturday with legacy behavior.

- [ ] **Step 2: Run focused tests to verify RED**

```powershell
& 'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests\calendar-checklist-sets.test.js
& 'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests\calendar-navigation.test.js
```

Expected: FAIL because helpers and client-aware matching are missing.

- [ ] **Step 3: Implement helpers**

Add near current calendar helpers:

```js
function isWeekendDate(dateKey){
  var ordinal=calendarDateOrdinal(dateKey);
  if(ordinal===null) return false;
  var parts=parseIsoDateParts ? parseIsoDateParts(dateKey) : null;
  var date=parts ? parts.date : null;
  if(!date) return false;
  var day=date.getUTCDay();
  return day===0 || day===6;
}
function workdayOrdinal(startDate,dateKey){
  var start=calendarDateOrdinal(startDate), date=calendarDateOrdinal(dateKey);
  if(start===null || date===null || date<start) return null;
  var count=0;
  for(var ordinal=start; ordinal<=date; ordinal++){
    var d=new Date(ordinal*86400000);
    var dow=d.getUTCDay();
    if(dow!==0 && dow!==6) count++;
  }
  return isWeekendDate(dateKey) ? null : count;
}
function cycleDayOrdinal(clientOrStart,dateKey){
  if(clientOrStart && typeof clientOrStart==="object"){
    return clientOrStart.excludeWeekends===true
      ? workdayOrdinal(clientOrStart.startDate,dateKey)
      : calendarDayOrdinal(clientOrStart.startDate,dateKey);
  }
  return calendarDayOrdinal(clientOrStart,dateKey);
}
```

Update `checklistPeriod` and `calendarTasksForDate` to detect object first parameter and call `cycleDayOrdinal`.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run both tests. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add index.html tests/calendar-checklist-sets.test.js tests/calendar-navigation.test.js
git commit -m "Add weekday cycle date helpers"
```

---

### Task 2: Client Weekend Setting

**Files:**
- Modify: `index.html`
- Test: `tests/client-save-renewal-count.test.js`
- Test: `tests/inline-script-syntax.test.js`

**Interfaces:**
- Consumes: `excludeWeekends` client field.
- Produces: client form checkbox `id="f-exclude-weekends"`.

- [ ] **Step 1: Write failing save/form tests**

In `tests/client-save-renewal-count.test.js`, add cases:

```js
assert.strictEqual(savedNewClient.value.excludeWeekends, true);
assert.strictEqual(savedExistingWithoutCheckboxDefault.value.excludeWeekends, false);
assert.strictEqual(savedExplicitUnchecked.value.excludeWeekends, false);
```

In `tests/inline-script-syntax.test.js`, assert:

```js
assert.match(html, /id="f-exclude-weekends"/);
assert.match(html, /주말 제외/);
```

- [ ] **Step 2: Run focused tests to verify RED**

```powershell
& 'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests\client-save-renewal-count.test.js
& 'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests\inline-script-syntax.test.js
```

Expected: FAIL because field is missing.

- [ ] **Step 3: Implement form field and persistence**

Add a checkbox to the client form:

```html
<label class="check-inline"><input id="f-exclude-weekends" type="checkbox"> 주말 제외</label>
```

When rendering a new client, default checked to `true`.

When rendering an existing client:

```js
exclude.checked = isEdit ? client.excludeWeekends===true : true;
```

When saving:

```js
excludeWeekends: document.getElementById("f-exclude-weekends").checked
```

For existing legacy clients, absent field is false unless user opens edit form and checks it.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run both tests. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add index.html tests/client-save-renewal-count.test.js tests/inline-script-syntax.test.js
git commit -m "Add weekend exclusion client setting"
```

---

### Task 3: Calendar Visual States

**Files:**
- Modify: `index.html`
- Test: `tests/calendar-status-and-contract-labels.test.js`

**Interfaces:**
- Consumes: `cycleDayOrdinal(client,dateKey)`
- Produces: `calendarDateState(client: object, dateKey: string): object`
- CSS classes: `is-weekend`, `is-outside-cycle`, `is-ended-cycle`.

- [ ] **Step 1: Write failing calendar render tests**

In `tests/calendar-status-and-contract-labels.test.js`, add assertions:

```js
const state = sandbox.calendarDateState({ startDate:'2026-08-10', excludeWeekends:true }, '2026-08-15');
assert.strictEqual(state.isWeekend, true);
assert.strictEqual(state.period, null);
assert.strictEqual(state.isOutsideCycle, false);

const outside = sandbox.calendarDateState({ startDate:'2026-08-10', excludeWeekends:true }, '2026-09-09');
assert.strictEqual(outside.isOutsideCycle, true);

const ended = sandbox.calendarDateState({
  startDate:'2026-09-14',
  excludeWeekends:true,
  previousCycles:[{ startDate:'2026-08-10' }]
}, '2026-08-11');
assert.strictEqual(ended.isEndedCycle, true);
```

Also assert rendered calendar HTML contains `is-weekend`, `is-outside-cycle`, `is-ended-cycle`, and `has-unfinished` remains when unfinished tasks exist.

- [ ] **Step 2: Run focused test to verify RED**

```powershell
& 'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests\calendar-status-and-contract-labels.test.js
```

Expected: FAIL because visual state helper/classes are missing.

- [ ] **Step 3: Implement calendar state and CSS**

Add CSS:

```css
.calendar-day.is-weekend{ background:#F8FAFC; color:var(--ink-300); }
.calendar-day.is-outside-cycle,.calendar-day.is-ended-cycle{ background:#F1F3F5; color:var(--ink-300); border-color:#E5E8EB; }
.calendar-day.is-outside-cycle .period,.calendar-day.is-ended-cycle .period{ opacity:.55; }
.calendar-day.is-outside-cycle.has-unfinished,.calendar-day.is-ended-cycle.has-unfinished{ outline-color:#DC2626; }
```

Add:

```js
function calendarDateState(client,dateKey){
  var period=checklistPeriod(client,dateKey);
  var ordinal=cycleDayOrdinal(client,dateKey);
  var isWeekend=client&&client.excludeWeekends===true&&isWeekendDate(dateKey);
  var isOutsideCycle=ordinal!==null && ordinal>cycleLength(client);
  var isEndedCycle=clientPreviousCycleContainsDate(client,dateKey);
  return { period:period, isWeekend:isWeekend, isOutsideCycle:isOutsideCycle, isEndedCycle:isEndedCycle };
}
```

Also implement `cycleLength(client)` returning `22` when `excludeWeekends===true`, otherwise `30`, and `clientPreviousCycleContainsDate(client,dateKey)` using archived cycle start dates and the same cycle length rules.

Update `calendarPanel` to call `calendarDateState(cl,key)` and append the classes.

- [ ] **Step 4: Run focused test to verify GREEN**

Run focused test. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add index.html tests/calendar-status-and-contract-labels.test.js
git commit -m "Add calendar muted cycle states"
```

---

### Task 4: Full Regression And Release Verification

**Files:**
- Modify only if tests reveal defects.
- Test: all files under `tests/`

**Interfaces:**
- Consumes all helpers and UI from Tasks 1-3.
- Produces deployable state.

- [ ] **Step 1: Run the full suite**

```powershell
$node='C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
Get-ChildItem tests -Filter *.test.js | Sort-Object Name | ForEach-Object { & $node $_.FullName; if($LASTEXITCODE -ne 0){ exit $LASTEXITCODE } }
& $node --check api\data.js
git diff --check
```

Expected: exit 0.

- [ ] **Step 2: Fix only defects found by verification**

If a test fails, reproduce focused failure, write/adjust focused regression, implement minimal fix, and rerun full suite.

- [ ] **Step 3: Verify release checklist**

Check:

- Existing client without `excludeWeekends` keeps legacy calendar behavior.
- New client form defaults weekend exclusion on.
- Weekend-exclusion client places day-6 work on the next Monday.
- Weekend dates are muted.
- Out-of-cycle dates are muted.
- Previous-cycle dates are muted.
- Unfinished task red outline remains visible.

- [ ] **Step 4: Commit repairs if any**

```powershell
git add index.html tests
git commit -m "Stabilize calendar workday cycles"
```

Only commit if files changed in Step 2.

---

## Self-Review Notes

- Spec coverage: weekend setting, workday ordinal, legacy fallback, muted weekends, outside active cycle, ended previous cycles, and unfinished outline are covered.
- Out of scope items remain excluded.
- No external dependencies are introduced.

