# Browser Demo Mode Design

## Goal

Add a password-free demo entry to the existing dashboard so prospective users can explore realistic workflows without reading or writing production data. The existing team-password login and shared Redis workspace remain unchanged.

## Entry Experience

The login screen keeps the password field and login button as the primary staff path. Below a divider, it adds a `데모 둘러보기` action and the explanation `운영 데이터와 연결되지 않는 체험용 화면입니다.`

Entering demo mode does not call `/api/auth` or load any Redis workspace keys. A persistent `DEMO` badge distinguishes the session from staff mode. The dashboard menu exposes `데모 초기화` and `운영 로그인으로 전환` actions.

## Data Isolation

The application introduces a workspace storage adapter with two implementations:

- Staff mode: the existing authenticated `/api/data` transport.
- Demo mode: a namespaced browser `localStorage` document.

All existing reads and writes used by client, checklist, calendar, report, revenue, contract, and guide screens go through this adapter. Demo mode must never attach a team token, call an authenticated mutation endpoint, or use production Redis keys.

The first demo visit clones an immutable seed document into browser storage. Subsequent edits survive refreshes in that browser. `데모 초기화` replaces the browser document with a fresh clone after confirmation. Switching to staff login clears only the active demo session flag; it does not delete the saved demo document.

Corrupt or unsupported demo storage is recovered by restoring the seed document and showing a non-blocking recovery notice.

## Seed Scenario

The demo contains three fictional businesses with relative dates derived from the visitor's current date so the intended states stay visible over time:

1. A new client whose cycle starts soon.
2. An active client in the second week with mixed completed and incomplete work.
3. A client in the fourth-week renewal season with renewal status, reports, revenue, and ad metrics.

The seed also contains:

- Weekday checklist templates and assigned work.
- Daily notes and calendar examples.
- Weekly and monthly reports.
- Revenue and advertising metrics with chart history.
- A draft and a signed-looking demo contract record.
- A completed-looking information-guide response.

All names, contact details, signatures, amounts, and answers are explicitly fictional and contain no copied customer data.

## Demo Feature Behavior

The following workflows remain editable and persist in the browser:

- Client creation and editing.
- Calendar navigation, task completion, and daily notes.
- Checklist set creation, application, completion, and deletion.
- Weekly and monthly reports, revenue, advertising metrics, and charts.
- Renewal workflow and progress states.
- Contract and information-guide authoring screens.

External or privileged effects are simulated:

- Contract links and information-guide links show a demo preview/result state but are not issued publicly.
- Signing and submission update only the browser demo record.
- PDF preview may use the browser print flow, but it must be marked as a demo document.
- Clipboard actions copy no production-capable public URL.

Attempting an unavailable external action shows `데모에서는 외부 링크가 발급되지 않습니다.` without losing the user's current edits.

## Analyzer

The dashboard menu retains access to the analyzer. Demo mode does not call Naver Search Ads or DataLab APIs. It provides prepared sample results for a small visible set of keywords, including keyword volume, related-keyword, bulk lookup, and trend-chart examples.

Unsupported keywords show a clear sample-data empty state and a list of available example keywords. Every analyzer result is labeled `데모 데이터 · 실제 네이버 수치가 아닙니다.` API status cards change to `샘플 데이터` instead of claiming a live Naver connection or displaying live quota use.

## UI and Motion

Demo mode reuses the production dashboard components and the current Toss-style visual system. The new demo badge, reset action, login switch, and notices follow the existing active motion tokens and reduced-motion behavior.

No separate `demo.html` is created. This avoids duplicated interfaces and ensures future production UI changes also appear in demo mode.

## Security Rules

- Demo entry requires no password.
- Demo mode cannot discover, request, or reuse the saved staff token.
- Demo mode cannot read any production workspace key.
- Demo mode cannot invoke Naver APIs or public-link issuance APIs.
- Staff mode behavior and API authorization remain unchanged.
- A page reload must preserve the chosen mode without allowing a demo flag to impersonate staff mode.

## Error Handling

- Browser storage unavailable: run the demo in memory for the current tab and disclose that refresh persistence is unavailable.
- Browser quota exceeded: preserve in-memory edits and show a retry/reset notice.
- Seed migration failure: replace only the demo document with the current seed version.
- Simulated external action: show an informational notice rather than a technical error.

## Verification

Automated tests must prove:

- Demo entry performs no auth or Redis request.
- Staff login and existing authenticated storage behavior are unchanged.
- Demo mutations persist after a simulated reload and reset to pristine seed data.
- Demo mode cannot call external link issuance or Naver endpoints.
- All three example client states and sample analyzer modes render.
- Corrupt storage recovery and unavailable-storage fallback work.
- Existing motion, checklist, calendar, report, guide, contract, and API authorization regressions remain covered.

Browser verification must cover desktop and 390px mobile flows for demo entry, client detail, calendar, checklist, reports, analyzer, reset, staff-login switching, and reduced-motion behavior.

## Out of Scope

- Shared demo data across visitors or devices.
- Publicly issued demo guide or contract links.
- Live Naver API calls from demo mode.
- Analytics, lead capture, or visitor accounts.
- A separate demo deployment or duplicated demo application.
