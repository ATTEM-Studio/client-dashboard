# Keyword Chart Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make keyword-volume summary cards, chart labels, and period rows easy to scan without changing data or interactions.

**Architecture:** Keep the existing single-file renderer and add narrowly scoped semantic classes to its generated markup. CSS owns hierarchy and responsive layout; the existing DataLab and keyword API calculations remain unchanged.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript, Node assertion tests.

## Global Constraints

- `월평균 검색량` uses `최근 1년 기준` as small secondary copy.
- `주평균 검색량` uses `최근 6개월 기준` as small secondary copy.
- Preserve period aggregation, automatic ranges, and pointer/touch tooltips.
- Do not add dependencies.

---

### Task 1: Improve metric and period readability

**Files:**
- Modify: `index.html`
- Test: `tests/naver-datalab.test.js`

**Interfaces:**
- Consumes: Existing `renderDataLabTrend`, `monthlyVolume`, `dailyAverage`, and `weeklyAverage` values.
- Produces: Semantic `.metric-label`, `.metric-context`, `.metric-value`, `.metric-unit`, `.period-index`, and `.period-index-badge` markup.

- [ ] **Step 1: Write the failing test**

Add assertions that the source contains `월평균 검색량`, `최근 1년 기준`, `주평균 검색량`, `최근 6개월 기준`, and the new semantic class names.

- [ ] **Step 2: Run test to verify it fails**

Run: bundled Node `tests/naver-datalab.test.js`
Expected: FAIL because the new copy and semantic classes do not exist.

- [ ] **Step 3: Write minimal implementation**

Update the generated summary-card and period-table markup, then add scoped CSS for stronger value hierarchy, smaller context text, separated units, visible axes, sticky table header, alternating rows, and a blue interest-index badge.

- [ ] **Step 4: Run focused and syntax tests**

Run: bundled Node `tests/naver-datalab.test.js` and `tests/inline-script-syntax.test.js`
Expected: both PASS.

- [ ] **Step 5: Verify responsive production behavior**

Inspect desktop and mobile widths; confirm labels do not overlap and the existing chart tooltip still appears on pointer/touch interaction.

- [ ] **Step 6: Commit and publish**

Commit only the implementation and test files, push `main`, deploy production, and verify the deployed page.
