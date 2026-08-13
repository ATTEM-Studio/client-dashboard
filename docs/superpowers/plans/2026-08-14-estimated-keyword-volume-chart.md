# Estimated Keyword Volume Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace DataLab-only ratio cards with clearly labelled estimated search-volume cards, chart, and table derived from exact monthly Keyword Tool volume and DataLab trend ratios.

**Architecture:** The single-keyword search runs the exact-match Search Ads Keyword Tool request and the DataLab trend request together. A pure estimator distributes the monthly PC+mobile volume across the returned periods in proportion to DataLab ratios, while retaining DataLab ratios for traceability. Related and bulk modes keep their existing Search Ads flows.

**Tech Stack:** Static HTML/CSS/JavaScript, Vercel Functions, Node assertion tests.

## Global Constraints

- Label every derived number as 예상 or 추정; never present it as measured traffic.
- Preserve single-tab day/week/month and date-range controls.
- Preserve related-keyword and bulk-query behavior.
- Format volumes with Korean thousands separators.

---

### Task 1: Estimate period search volumes

**Files:**
- Modify: `index.html`
- Test: `tests/naver-datalab.test.js`

**Interfaces:**
- Consumes: exact Keyword Tool row and DataLab `{period, ratio}` points.
- Produces: `estimateKeywordVolumes(monthlyVolume, points)` returning period estimates whose rounded total matches the scaled period total.

- [ ] Write assertions for the estimator, exact-match request, estimate labels, and result table.
- [ ] Run the focused test and confirm it fails for the missing estimator.
- [ ] Add the pure estimator and combine both API responses in single mode.
- [ ] Render four summary cards: recent month, daily average, recent-year monthly average, recent-six-month weekly average.
- [ ] Render a readable chart with Y-axis labels, hover values, and a period/value table.
- [ ] Run focused and syntax tests and check the diff.

### Task 2: Publish and verify production

**Files:**
- Modify: no production files beyond Task 1.

**Interfaces:**
- Consumes: verified Task 1 output.
- Produces: production deployment at the existing dashboard URL.

- [ ] Commit only scoped files.
- [ ] Push `main` and deploy production.
- [ ] Verify single search, each aggregation mode, custom dates, and unchanged related/bulk tabs in the live browser.
