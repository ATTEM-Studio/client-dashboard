# Checklist Week Accordion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 업체별 업무 체크리스트를 주차별 접이식 목록으로 바꾼다.

**Architecture:** 기존 단일 `index.html` 구조를 유지하고, 체크리스트 패널에 그룹화 헬퍼와 토글 상태만 추가한다. 저장 데이터 구조는 바꾸지 않는다.

**Tech Stack:** Static HTML/CSS/JavaScript, bundled Node.js tests.

## Global Constraints

- 기존 업무 완료/삭제/추가/세트 적용 기능을 유지한다.
- 업무 데이터 스키마는 변경하지 않는다.
- 미배정 업무는 보존하고 임의 날짜에 배치하지 않는다.
- 주말 제외/마무리 기간 계산은 기존 헬퍼를 재사용한다.

---

### Task 1: Checklist Group Helpers and Rendering

**Files:**
- Modify: `index.html`
- Modify/Test: `tests/calendar-status-and-contract-labels.test.js`

**Interfaces:**
- Consumes: `checklistPeriod(client, dateKey)`, `dailyPeriod(day)`, `periodLabel(period)`
- Produces: `checklistTaskPeriod(client, task)`, `checklistSections(client, tasks)`

- [ ] **Step 1: Write the failing test**

Add assertions that a checklist panel renders `1주차`, `2주차`, `마무리`, and `미배정` accordion headers with grouped rows.

- [ ] **Step 2: Run test to verify it fails**

Run `node tests/calendar-status-and-contract-labels.test.js`. Expected: FAIL because accordion markup does not exist.

- [ ] **Step 3: Implement grouping and accordion markup**

Add helper functions and replace the flat task list in `checklistPanel`.

- [ ] **Step 4: Run focused tests**

Run `node tests/calendar-status-and-contract-labels.test.js`. Expected: PASS.

- [ ] **Step 5: Verify full suite and commit**

Run all test files and `git diff --check`, then commit.
