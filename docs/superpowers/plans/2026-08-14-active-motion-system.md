# Active Dashboard Motion System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a consistent, responsive, active motion system to the dashboard without changing stored business data or breaking existing workflows.

**Architecture:** Keep the existing single-file application structure and add a small CSS token layer plus narrowly scoped JavaScript transition helpers inside `index.html`. Motion remains a presentation concern: event handlers update current application state as they do today, while helpers coordinate press feedback, interruptible entry/exit, and save-state feedback. Static and behavioral Node tests protect tokens, reduced-motion behavior, bindings, and existing client/calendar/keyword flows.

**Tech Stack:** Static HTML, CSS custom properties, vanilla JavaScript, existing Node-based source tests, Vercel static deployment.

## Global Constraints

- Use `transform` and `opacity` for primary animation work; avoid layout-thrashing animation properties.
- Immediate feedback lasts 90–120ms, short transitions 160–220ms, and spatial transitions 380–520ms.
- Respect `prefers-reduced-motion: reduce` by removing spatial movement and retaining only a short fade or immediate state change.
- Preserve all existing client, contract, checklist, revenue, report, guide, calendar, and keyword data formats.
- Motion must never block buttons, links, saving, querying, keyboard focus, or rapid repeated input.
- Do not add sound, vibration, 3D effects, or persistent background animation.
- Keep unrelated untracked planning and brainstorm files untouched.

## File Structure

- Modify `index.html`: define motion tokens, component states, transition helpers, and bindings using existing render functions.
- Create `tests/active-motion-system.test.js`: verify the motion contract and execute pure helper behavior extracted from the inline script.
- Reuse existing tests for dashboard, client detail, checklist, calendar, contracts, revenue, and keyword regressions.

---

### Task 1: Motion Tokens, Reduced Motion, and Transition Helpers

**Files:**
- Modify: `index.html:1-220`
- Modify: `index.html:1210-1290`
- Create: `tests/active-motion-system.test.js`

**Interfaces:**
- Consumes: existing `.btn`, `.client-card`, `.modal`, `#toast`, and `showToast(message)` behavior.
- Produces: CSS variables `--motion-press`, `--motion-short`, `--motion-spatial`, `--ease-spring`, `--ease-out`; helpers `restartMotion(element, className)`, `setAsyncVisualState(element, state)`, and `motionReduced()`.

- [ ] **Step 1: Write the failing token and helper tests**

```js
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

assert.match(source, /--motion-press:\s*110ms/);
assert.match(source, /--motion-short:\s*200ms/);
assert.match(source, /--motion-spatial:\s*460ms/);
assert.match(source, /--ease-spring:/);
assert.match(source, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
assert.match(source, /function restartMotion\(element,className\)/);
assert.match(source, /function setAsyncVisualState\(element,state\)/);

const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
const helper = script.match(/function restartMotion\(element,className\)[\s\S]*?\n\s*}/)[0];
const classes = new Set();
const element = {
  classList: { remove: c => classes.delete(c), add: c => classes.add(c) },
  offsetWidth: 10
};
vm.runInNewContext(`${helper}; restartMotion(element, 'motion-enter')`, { element });
assert.equal(classes.has('motion-enter'), true);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: bundled Node executable followed by `tests/active-motion-system.test.js`.

Expected: FAIL because motion variables and helpers are absent.

- [ ] **Step 3: Add the shared CSS tokens and base states**

Add to `:root`:

```css
--motion-press:110ms;
--motion-short:200ms;
--motion-spatial:460ms;
--ease-spring:cubic-bezier(.2,.9,.25,1.12);
--ease-out:cubic-bezier(.2,.7,.2,1);
```

Replace component-specific raw transition times with the variables. Add reusable states:

```css
.is-pressing{transform:scale(.975)}
.motion-enter{animation:motionEnter var(--motion-spatial) var(--ease-spring) both}
.is-saving{cursor:progress;opacity:.78}
.is-saved{animation:saveSettle var(--motion-short) var(--ease-spring)}
.is-save-error{color:var(--danger);border-color:var(--danger)}
@keyframes motionEnter{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
@keyframes saveSettle{50%{transform:scale(1.025)}}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{scroll-behavior:auto!important;animation-duration:1ms!important;animation-iteration-count:1!important;transition-duration:1ms!important}
  .motion-enter{animation-name:motionFade}
}
@keyframes motionFade{from{opacity:0}to{opacity:1}}
```

- [ ] **Step 4: Add minimal interruptible helpers**

Place near `showToast`:

```js
function motionReduced(){
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function restartMotion(element,className){
  if(!element)return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}
function setAsyncVisualState(element,state){
  if(!element)return;
  ['is-saving','is-saved','is-save-error'].forEach(function(name){element.classList.remove(name);});
  if(state==='saving')element.classList.add('is-saving');
  if(state==='saved')restartMotion(element,'is-saved');
  if(state==='error')element.classList.add('is-save-error');
}
```

- [ ] **Step 5: Run focused and syntax tests**

Run:

```text
tests/active-motion-system.test.js
tests/inline-script-syntax.test.js
```

Expected: both PASS.

- [ ] **Step 6: Commit Task 1**

```text
git add index.html tests/active-motion-system.test.js
git commit -m "Add dashboard motion foundation"
```

---

### Task 2: Home Cards, Dashboard Menu, Tabs, Modals, and Toasts

**Files:**
- Modify: `index.html:35-215`
- Modify: `index.html:1230-1290`
- Modify: `index.html:1800-1950`
- Modify: `tests/active-motion-system.test.js`
- Test: `tests/contract-management.test.js`

**Interfaces:**
- Consumes: Task 1 motion tokens and helpers; existing `renderHome`, `renderClientInfoModal`, `confirmDialog`, `closeModal`, and dashboard-menu bindings.
- Produces: `bindPressFeedback(root)`, origin-aware modal CSS variables `--motion-origin-x` and `--motion-origin-y`, and `.tab-content-enter` state.

- [ ] **Step 1: Add failing assertions for interactive bindings**

```js
assert.match(source, /function bindPressFeedback\(root\)/);
assert.match(source, /pointerdown/);
assert.match(source, /pointerup/);
assert.match(source, /--motion-origin-x/);
assert.match(source, /\.dashboard-menu-panel[^}]*transform-origin/);
assert.match(source, /\.modal-layer\.show \.modal/);
assert.match(source, /\.tab-content-enter/);
assert.match(source, /aria-expanded/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Expected: FAIL on the missing press binding and origin-aware modal states.

- [ ] **Step 3: Implement press feedback and bind it after each render**

```js
function bindPressFeedback(root){
  (root||document).querySelectorAll('.btn,.client-card,[data-client-tab],.dashboard-menu-item').forEach(function(element){
    if(element.dataset.pressBound)return;
    element.dataset.pressBound='true';
    var release=function(){element.classList.remove('is-pressing');};
    element.addEventListener('pointerdown',function(){if(!element.disabled)element.classList.add('is-pressing');});
    element.addEventListener('pointerup',release);
    element.addEventListener('pointercancel',release);
    element.addEventListener('pointerleave',release);
  });
}
```

Call `bindPressFeedback(app)` after home, keyword-tool, and client-detail bindings complete. Do not attach duplicate listeners.

- [ ] **Step 4: Animate menu, tabs, modal, and toast using existing state**

- Set menu `transform-origin:top right` and stagger its two current items with `transition-delay` only while open.
- Keep `aria-expanded` synchronized before the opening class changes.
- Wrap the active client tab content with `.tab-content-enter` and restart only when `state.clientTab` changes.
- Before opening a modal from a clicked card or button, set origin variables from its bounding rectangle; default to the viewport center when no trigger exists.
- Change modal hiding so the exit class completes before `display:none`, but guard the timer with a sequence number so reopening during exit wins.
- Keep toast timers cancellable so a new toast replaces the previous message without waiting.

- [ ] **Step 5: Run focused and home/contract regression tests**

Run:

```text
tests/active-motion-system.test.js
tests/contract-management.test.js
tests/client-save-renewal-count.test.js
tests/inline-script-syntax.test.js
```

Expected: motion tests and syntax pass. If the known contract test still expects `btn-new-client`, confirm the failure is identical to the pre-task baseline and do not change the current `btn-menu-new-client` product behavior merely to satisfy the stale assertion.

- [ ] **Step 6: Commit Task 2**

```text
git add index.html tests/active-motion-system.test.js
git commit -m "Animate dashboard navigation and overlays"
```

---

### Task 3: Client Detail, Checklist Save Feedback, and Calendar Movement

**Files:**
- Modify: `index.html:268-465`
- Modify: `index.html:2500-2940`
- Modify: `tests/active-motion-system.test.js`
- Test: `tests/checklist-week-accordion.test.js`
- Test: `tests/calendar-navigation.test.js`
- Test: `tests/calendar-workday-final-fixes.test.js`

**Interfaces:**
- Consumes: `restartMotion`, `setAsyncVisualState`, existing `saveClientAndRefresh(client)`, `renderClientWorkspace(client)`, `bindCalendarPanel(client)`, and checklist bindings.
- Produces: `saveClientWithFeedback(client, element)` returning `Promise<void>` and calendar direction class `.calendar-enter-left` or `.calendar-enter-right`.

- [ ] **Step 1: Add failing behavioral contract tests**

```js
assert.match(source, /async function saveClientWithFeedback\(client,element\)/);
assert.match(source, /setAsyncVisualState\(element,'saving'\)/);
assert.match(source, /setAsyncVisualState\(element,'saved'\)/);
assert.match(source, /setAsyncVisualState\(element,'error'\)/);
assert.match(source, /calendar-enter-left/);
assert.match(source, /calendar-enter-right/);
assert.match(source, /check-section-body[^}]*overflow:hidden/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Expected: FAIL because async visual feedback and calendar direction classes are absent.

- [ ] **Step 3: Add save feedback without changing stored data**

```js
async function saveClientWithFeedback(client,element){
  setAsyncVisualState(element,'saving');
  try{
    await saveClientAndRefresh(client);
    setAsyncVisualState(element,'saved');
  }catch(error){
    setAsyncVisualState(element,'error');
    showToast('저장하지 못했습니다. 다시 시도해 주세요.');
    throw error;
  }
}
```

Use the helper for checklist completion, daily-popup completion, and note saving. Preserve the prior `done` value and restore it before rendering when persistence fails.

- [ ] **Step 4: Add checklist and calendar spatial transitions**

- Animate accordion disclosure with an inner wrapper using grid rows or measured height; keep `aria-expanded` authoritative.
- Apply existing blue/green/yellow today status classes immediately before persistence begins.
- Set calendar navigation direction from the clicked `data-calendar-month` value, render, then apply `.calendar-enter-left` for next and `.calendar-enter-right` for previous.
- The day modal originates from the selected calendar cell and retains keyboard focus management.
- Never replay the entire client workspace animation for a single checklist toggle.

- [ ] **Step 5: Run focused and client-workflow regressions**

Run:

```text
tests/active-motion-system.test.js
tests/checklist-week-accordion.test.js
tests/calendar-navigation.test.js
tests/calendar-workday-final-fixes.test.js
tests/calendar-status-and-contract-labels.test.js
tests/inline-script-syntax.test.js
```

Expected: all PASS.

- [ ] **Step 6: Commit Task 3**

```text
git add index.html tests/active-motion-system.test.js
git commit -m "Animate client checklist and calendar flows"
```

---

### Task 4: Graphs, Gauges, Tooltips, and Release Verification

**Files:**
- Modify: `index.html:80-190`
- Modify: `index.html:690-770`
- Modify: `index.html:1710-1765`
- Modify: `tests/active-motion-system.test.js`
- Test: `tests/naver-datalab.test.js`
- Test: `tests/revenue-reporting.test.js`
- Test: `tests/thirty-day-progress.test.js`

**Interfaces:**
- Consumes: Task 1 motion tokens, existing DataLab SVG point markup, revenue bars, `.progress-fill`, and `.day-progress-fill`.
- Produces: `animateValueChange(element, from, to, formatter)` and value-preserving graph/gauge transitions.

- [ ] **Step 1: Add failing graph and gauge assertions**

```js
assert.match(source, /function animateValueChange\(element,from,to,formatter\)/);
assert.match(source, /requestAnimationFrame/);
assert.match(source, /\.datalab-line[^}]*stroke-dasharray/);
assert.match(source, /\.datalab-hit[^}]*transition/);
assert.match(source, /data-previous-value/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Expected: FAIL because value interpolation and line-draw states are absent.

- [ ] **Step 3: Implement value interpolation with reduced-motion fallback**

```js
function animateValueChange(element,from,to,formatter){
  if(!element)return;
  if(motionReduced()){
    element.textContent=formatter(to);
    element.dataset.previousValue=String(to);
    return;
  }
  var started=performance.now(),duration=460,difference=to-from;
  function frame(now){
    var progress=Math.min(1,(now-started)/duration);
    var eased=1-Math.pow(1-progress,3);
    element.textContent=formatter(from+difference*eased);
    if(progress<1)requestAnimationFrame(frame);
    else element.dataset.previousValue=String(to);
  }
  requestAnimationFrame(frame);
}
```

Read the prior value from `data-previous-value`; do not restart gauges at zero after filter or data updates.

- [ ] **Step 4: Improve graph entry and point interaction**

- Draw a newly queried line once using stroke dash offset; do not replay it during scroll.
- Increase only the hovered/touched point and place the existing tooltip in the nearest available chart space.
- Keep the tooltip available by pointer, touch, and keyboard focus.
- Preserve current daily/weekly/monthly/annual aggregation and local-date behavior.
- Animate revenue bars and monthly progress gauges from their prior rendered values.

- [ ] **Step 5: Run the full automated suite**

Run every `tests/*.test.js` file with the bundled Node runtime, then run `git diff --check`.

Expected:

- New motion test passes.
- DataLab, revenue, progress, calendar, checklist, guide, contract, and syntax suites pass.
- The only acceptable exception is the already documented stale `btn-new-client` assertion if it remains unchanged from the baseline; record it explicitly rather than hiding it.
- `git diff --check` prints no errors.

- [ ] **Step 6: Verify representative browser flows**

At desktop and 390px mobile widths verify:

1. Open/close the top menu rapidly and choose both existing actions.
2. Press a client card, enter detail, change tabs rapidly, and return home.
3. Toggle checklist work during save, open/close week sections, and confirm failure feedback remains usable.
4. Move the calendar both directions and complete a task in the daily modal.
5. Query a keyword, switch chart aggregation, hover/touch graph points, and confirm tooltip readability.
6. Enable reduced motion and repeat menu, modal, checklist, and graph interactions without spatial movement.
7. Confirm no horizontal overflow and no permanently locked backdrop or focus.

- [ ] **Step 7: Commit Task 4**

```text
git add index.html tests/active-motion-system.test.js
git commit -m "Animate dashboard data visualizations"
```

- [ ] **Step 8: Request final code review before publishing**

Review the complete range from the design-document parent through Task 4 for spec compliance, rapid-interaction correctness, reduced-motion behavior, performance, and unrelated regressions. Resolve Important or Critical findings with focused RED/GREEN tests before push and production deployment.
