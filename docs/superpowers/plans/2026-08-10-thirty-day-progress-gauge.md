# 30일 진행 게이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 업체 카드의 주차 버튼을 계약 시작일 기준 30일 자동 진행 게이지로 교체한다.

**Architecture:** `index.html` 안에 순수 날짜 계산 함수 `thirtyDayProgress(startDate, now)`를 추가한다. 대시보드의 카드 렌더링은 이 함수의 결과만 사용해 진행 폭, 현재 주차, 남은 일수 또는 예외 상태를 표시하며, 상세 화면과 기존 `progress` 데이터는 유지한다.

**Tech Stack:** 정적 HTML, CSS, 브라우저 JavaScript, Node.js 내장 `assert`/`vm` 테스트 러너.

## Global Constraints

- 30일 계산은 업체의 기존 `startDate`를 Day 1로 사용한다.
- 주차 구간은 1~7일, 8~14일, 15~21일, 22~28일, 29~30일이다.
- 시작 전·시작일·7일째·8일째·30일째·30일 초과·시작일 없음 상태를 모두 처리한다.
- 목록 카드만 바꾸며, 상세 화면의 주차 버튼과 `progress` 데이터 및 기존 통계 카드는 변경하지 않는다.
- 날짜는 로컬 날짜 단위로 정규화한다.

---

### Task 1: 30일 진행 계산 함수와 경계값 테스트

**Files:**
- Modify: `index.html:358-374`
- Create: `tests/thirty-day-progress.test.js`

**Interfaces:**
- Produces: `thirtyDayProgress(startDate, now)` returning `{ state, elapsed, week, percent, remaining }`.
- Consumes: ISO 날짜 문자열인 `startDate`와 선택적 `Date` 인스턴스 `now`.

- [ ] **Step 1: Write the failing test**

```js
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const html=fs.readFileSync('index.html','utf8');
const match=html.match(/(function thirtyDayProgress[\s\S]*?\n  }\n)(?=  function computeDelta)/);
assert.ok(match, 'thirtyDayProgress must exist in index.html');
const sandbox={};
vm.runInNewContext(match[1], sandbox);
const progress=(start, today)=>JSON.parse(JSON.stringify(sandbox.thirtyDayProgress(start, new Date(today+'T12:00:00'))));
assert.deepStrictEqual(progress('2026-07-22', '2026-07-21'), { state: 'upcoming', elapsed: 0, week: 0, percent: 0, remaining: 30 });
assert.deepStrictEqual(progress('2026-07-22', '2026-07-22'), { state: 'active', elapsed: 1, week: 1, percent: 3, remaining: 29 });
assert.deepStrictEqual(progress('2026-07-22', '2026-07-29'), { state: 'active', elapsed: 8, week: 2, percent: 27, remaining: 22 });
assert.deepStrictEqual(progress('2026-07-22', '2026-08-20'), { state: 'complete', elapsed: 30, week: 5, percent: 100, remaining: 0 });
assert.deepStrictEqual(progress('', '2026-08-10'), { state: 'missing', elapsed: 0, week: 0, percent: 0, remaining: 30 });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/thirty-day-progress.test.js`

Expected: FAIL because `thirtyDayProgress` is not yet present in `index.html`.

- [ ] **Step 3: Write minimal implementation**

```js
function thirtyDayProgress(startDate, now){
  if(!startDate) return { state:'missing', elapsed:0, week:0, percent:0, remaining:30 };
  var start=new Date(startDate+'T00:00:00');
  var today=new Date(now||new Date()); today.setHours(0,0,0,0);
  var raw=Math.floor((today-start)/86400000)+1;
  if(raw<1) return { state:'upcoming', elapsed:0, week:0, percent:0, remaining:30 };
  var elapsed=Math.min(raw,30);
  return { state:raw>=30?'complete':'active', elapsed:elapsed, week:Math.ceil(elapsed/7), percent:Math.round(elapsed/30*100), remaining:30-elapsed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/thirty-day-progress.test.js`

Expected: PASS for all five explicit states.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/thirty-day-progress.test.js
git commit -m "Add 30-day progress calculation"
```

### Task 2: 업체 카드 선형 게이지 렌더링

**Files:**
- Modify: `index.html:106-116`
- Modify: `index.html:642-695`
- Test: `tests/thirty-day-progress.test.js`

**Interfaces:**
- Consumes: `thirtyDayProgress(c.startDate)` from Task 1.
- Produces: `.day-progress`, `.day-progress-fill`, `.day-progress-weeks`, and `.day-progress-copy` card markup.

- [ ] **Step 1: Extend the failing test with display inputs**

```js
var active=progress('2026-07-22', '2026-08-02');
assert.strictEqual(active.week, 2);
assert.strictEqual(active.elapsed, 12);
assert.strictEqual(active.percent, 40);
assert.strictEqual(active.remaining, 18);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/thirty-day-progress.test.js`

Expected: FAIL because the 12-day case is not yet included in the test file.

- [ ] **Step 3: Replace only dashboard card week-strip markup**

```js
var day=thirtyDayProgress(c.startDate);
var gauge=day.state==='missing'
  ? '<p class="panel-hint">시작일을 등록해 주세요.</p>'
  : '<div class="day-progress"><div class="day-progress-copy"><strong>'+
    (day.state==='upcoming'?'시작 전':day.week+'주차 · '+day.elapsed+'일 / 30일')+
    '</strong><span>'+(day.state==='complete'?'30일 완료':day.remaining+'일 남음')+
    '</span></div><div class="day-progress-track"><div class="day-progress-fill" style="width:'+day.percent+'%"></div></div><div class="day-progress-weeks"><span>1주차</span><span>2주차</span><span>3주차</span><span>4주차</span><span>5주차</span></div></div>';
```

Use `gauge` in the dashboard card in place of `<div class="week-strip">'+cells+'</div>`, then remove the dashboard-only `.week-cell` click binding. Keep the detail-screen `.week-cell` bindings unchanged.

- [ ] **Step 4: Add responsive CSS**

```css
.day-progress-track{height:12px;border-radius:999px;background:#EEF1F5;overflow:hidden}
.day-progress-fill{height:100%;border-radius:inherit;background:linear-gradient(90deg,#1677FF,#4D96FF);transition:width .5s ease}
.day-progress-weeks{display:grid;grid-template-columns:7fr 7fr 7fr 7fr 2fr;margin-top:6px;font-size:10.5px;color:var(--ink-400);text-align:center}
```

Add the corresponding `.day-progress` and `.day-progress-copy` rules beside the existing week-strip rules. At the existing mobile breakpoint, allow the copy row to wrap rather than truncate.

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/thirty-day-progress.test.js`

Expected: PASS, including the 12-day/2주차/40% case.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/thirty-day-progress.test.js
git commit -m "Show 30-day gauges on client cards"
```

### Task 3: Static validation and visual check

**Files:**
- Modify: `README.md` only if the UI behaviour requires user-facing documentation.

**Interfaces:**
- Consumes: final `index.html` and `tests/thirty-day-progress.test.js`.
- Produces: verified responsive dashboard-card rendering with no change to detail-week controls.

- [ ] **Step 1: Run automated date validation**

Run: `node tests/thirty-day-progress.test.js`

Expected: PASS with all start-date edge cases and the 12-day display case.

- [ ] **Step 2: Check static markup and scope**

Run: `rg -n "day-progress|week-cell" index.html`

Expected: dashboard cards render `day-progress`; `week-cell` remains in the client-detail renderer.

- [ ] **Step 3: Inspect the dashboard at desktop and narrow widths**

Open the app with a sample client whose `startDate` is 12 days ago. Confirm `2주차 · 12일 / 30일`, a 40% blue fill, five week labels, and `18일 남음` are visible without overlap at desktop and 360px widths.

- [ ] **Step 4: Commit verification-related documentation only if changed**

```bash
git add README.md
git commit -m "Document 30-day progress gauge"
```
