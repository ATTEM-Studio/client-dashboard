# Client Information Guide Design

## Goal

Add a client-specific `정보 안내문` tab that lets the team issue one permanent, mobile-friendly onboarding questionnaire link per client and manage the submitted information inside that same client page.

## Scope

- Add `정보 안내문` after the existing client detail tabs: 일정 달력, 업무 체크리스트, 리포트.
- The team issues a questionnaire link manually from this tab. A link is issued once and never regenerated or revoked.
- The link is public to anyone who holds it; it supports mobile completion, automatic draft saving, progress display, continued editing, submission, and later editing through the same link.
- Store drafts, latest submitted answers, and internal review state in the existing Upstash Redis API.
- Do not accept file uploads. Ask only for the material status: `보유함`, `별도 전달 예정`, or `없음`.

## Link and Access Model

When issued, the server/client creates a high-entropy opaque questionnaire ID and stores one document at `guide:<guideId>` with `clientId`, timestamps, and a secret-free public identifier. The client record stores `guideId` so the tab can find it.

The questionnaire opens at `/?guide=<guideId>`. It is intentionally editable through the permanent link: no login, submission lock, regeneration, or revocation control exists in this scope. Existing report share links remain unchanged.

## Questionnaire Experience

### Sections and progress

The questionnaire renders as three mobile-first sections with a visible progress bar:

1. 매장과 목표
2. 고객과 메시지
3. 운영과 확인

Answers auto-save after a short debounced input pause and on section change. A returning visitor on the same URL loads the saved draft. The UI always states whether saving is in progress, saved, or failed, with a retry action on failure.

### Questions

All questions are optional unless stated otherwise. Blank answers are valid and become follow-up items after submission.

- 현재 매장의 가장 큰 고민
- 최우선 마케팅 목표
- 우선 홍보 메뉴
- 현재 주요 고객
- 유치하고 싶은 고객
- 매장 핵심 강점
- 꼭 알리고 싶은 이야기
- 원하는 콘텐츠 분위기
- 피하고 싶은 표현
- 보유 사진·영상 자료 상태: `보유함` / `별도 전달 예정` / `없음`
- 검수 및 승인 담당자 이름과 연락 수단
- 운영 시 주의사항

The client contract's service field, when present, adds a small service-context prompt without hiding the common questions. The first version must not invent service-specific required fields.

### Submission and later editing

`제출하기` validates no required free-text fields because all question answers are optional, saves the current answers as the latest submission, and shows a completion screen. The completion screen states that the same link remains editable and provides `답변 수정하기`, which returns to the form with saved answers.

## Client Detail Information Guide Tab

### Before link issuance

Show the purpose of the questionnaire and one `설문 링크 발급` action. The tab must not create a link on client registration or tab open.

### After issuance

Show:

- permanent questionnaire URL with copy and preview actions;
- status: `미작성`, `작성 중`, or `제출 완료`;
- latest saved/submitted timestamp;
- a compact key-information summary;
- collapsible original answers;
- `추가 확인 필요` items;
- internal memo;
- review state selector: `미확인`, `확인 중`, `확인 완료`.

The team can edit only the internal memo and review state in the dashboard. Client questionnaire answers are edited through the permanent public link and always preserve the latest original answer set.

## Follow-up and Summary Rules

`추가 확인 필요` contains a human-readable label for each blank text answer, blank approval contact, and material status `별도 전달 예정`. It never labels material status `없음` as missing.

The first version's “핵심 정보 요약” is deterministic rather than AI-generated: it combines nonblank target, menu, target customer, strength, and key story values into short labeled lines. If no meaningful answers exist, show `아직 요약할 정보가 없습니다.`

## Data Shape

```js
{
  id: "guide_...",
  clientId: "client_...",
  createdAt: 0,
  updatedAt: 0,
  submittedAt: null,
  answers: {
    concern: "", goal: "", priorityMenu: "", currentCustomers: "",
    desiredCustomers: "", strengths: "", story: "", contentTone: "",
    avoidExpressions: "", materialStatus: "", approverName: "",
    approverContact: "", operatingNotes: ""
  },
  review: { status: "unreviewed", memo: "" }
}
```

The existing Redis API stores this at `guide:<id>` and updates the associated client document with `guideId`. Existing clients without `guideId` remain unchanged.

## Error Handling and Compatibility

- Invalid or missing guide IDs show a public “찾을 수 없는 안내문” state with no dashboard data exposure.
- Redis save/read failure shows a clear retry state; it must not falsely show saved/submitted status.
- Empty and partial drafts remain valid and persist.
- Existing team login, report sharing, clients, reports, checklists, calendar, revenue data, and notes remain functional.

## Verification

- Test new guide creation only occurs by explicit action and is linked to one client.
- Test draft save/load, submission, later public editing, missing guide, and failure UI markers.
- Test follow-up classification and deterministic summary output.
- Test tab before/after issuance, link copy/preview markers, internal memo/status persistence, and legacy clients.
- Verify mobile layout and persistent public-link behavior in a browser before production deployment.
