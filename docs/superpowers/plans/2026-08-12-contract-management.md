# Contract Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계약서 생성/서명/저장/업체별 조회와 재계약 회차 수정을 구현한다.

**Architecture:** 기존 단일 HTML 앱 구조를 유지한다. 계약서는 `contracts-index` 공개 인덱스와 `contract:<id>` 보안 문서로 저장하며, 화면은 `state.view === "contractForm"`와 업체 상세 `contracts` 탭으로 연결한다.

**Tech Stack:** Static HTML/CSS/JavaScript, Upstash-backed API, bundled Node.js tests.

## Global Constraints

- PDF/외부 전자계약 연동은 포함하지 않는다.
- 재계약 회차 수정은 기존 체크리스트/리포트/매출/안내문 데이터를 삭제하지 않는다.
- 계약서 저장 실패 시 사용자가 다시 저장할 수 있어야 한다.
- 기존 업체 등록/상세/리포트/안내문 테스트를 유지한다.

---

### Task 1: Contract Builder and Renewal Count Edit

**Files:**
- Modify: `index.html`
- Create/Test: `tests/contract-management.test.js`

**Interfaces:**
- Produces: `blankContract()`, `contractClientOptions(clients)`, `clientContracts(clientId)`, `renderContractForm(base)`, `saveContractFromForm()`, `contractsPanel(client)`

- [ ] **Step 1: Write failing tests**

Create tests that assert the dashboard contract button, contract form fields, signature canvas, save behavior, contracts panel filtering, and renewal-count field exist.

- [ ] **Step 2: Run focused test for RED**

Run `node tests/contract-management.test.js`. Expected: FAIL because the new contract functions/markup do not exist.

- [ ] **Step 3: Implement minimal UI and persistence**

Add `contracts` state/load, dashboard button, contract form, signature canvas binding, save function, detail tab, contracts panel, and renewal count field.

- [ ] **Step 4: Run focused and full tests**

Run contract test, inline syntax test, then all tests.

- [ ] **Step 5: Commit, push, deploy**

Commit the scoped changes, push `main`, deploy to Vercel production, and verify the deployed page contains the new contract markers.
