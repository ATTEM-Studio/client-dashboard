# Revenue Reporting and Calendar Status Design

## Goal

Make revenue an optional, report-led record: weekly reports collect the source values, monthly reports compare the current-month automatic total with the previous month, and the client report tab continuously shows the available revenue trend. Improve the home and calendar views so contract state, weekly schedule, and unfinished work are immediately recognizable.

## Scope

- Remove the explanatory sentence below the home headline.
- Show a client contract label beside each home progress-card client name: `신규` or `재계약 N회차`.
- Colour the 30-day client calendar by period using a very light full-cell background plus a stronger period badge and border.
- Mark a calendar date with unfinished assigned work using a red status outline/indicator; a task is unfinished when `done !== true`.
- Add optional weekly and monthly revenue fields to reports.
- Add a revenue summary/graph beneath the report list in the client report tab when at least one revenue value is available.

## Revenue Data Model

Each saved report may contain an optional `revenue` object. Reports without it remain valid and display exactly as they do today.

```js
{
  weekly: Number | null,       // revenue for this weekly report
  monthlyOverride: Number | null, // optional confirmed current-month amount
  previousMonth: Number | null    // optional prior-month comparison amount
}
```

Weekly report values are the source for the automatic current-month total. The current-month total is the sum of weekly revenue values whose report period belongs to the selected report month. A monthly `monthlyOverride` replaces the automatic total only for that monthly report's comparison/display. The report tab's ongoing graph always uses the latest available monthly override for that month; otherwise it uses the summed weekly values.

No amount is inferred from blank fields, and zero is treated as a deliberately entered value. The revenue UI is shown only when at least one usable weekly amount, monthly override, or previous-month amount exists for that client.

## Report Form and Report View

### Weekly report

- Add an optional “이번 주 매출” currency input.
- Leave it blank to omit revenue from that report.
- When saved, it contributes to the report-tab month total and the monthly report's automatic total.

### Monthly report

- Show the automatically summed “해당월 주간 보고서 합산” amount when weekly values exist.
- Add optional “전월 매출” and “해당월 확정 매출” currency inputs.
- The confirmed current-month amount takes precedence over the automatic total for that monthly report's comparison card.

### Revenue presentation

- Report view shows a revenue comparison section only when that report has a revenue value or a relevant automatic total.
- Client report tab adds a “매출 추이” panel below the report list only when the client has usable revenue data.
- The panel groups the current report month by weeks, uses a bar per entered week, and shows a light-gray exact Korean amount above each bar.
- The vertical axis uses Korean amounts such as `0`, `100만`, `200만`; its maximum is rounded up to a sensible 100만-based step.
- There is no trend line and no click-to-reveal interaction.
- The current week/month bar may use the existing green accent; other bars use the blue brand accent.
- An inline entry/edit affordance in the revenue panel opens the appropriate weekly/monthly report editor rather than creating a second data store.

## Calendar Status Rules

- Periods are `1주차`, `2주차`, `3주차`, `4주차`, and `마무리` (days 29–30).
- Each calendar cell receives a pale period background, a matching stronger border, and a matching period badge.
- Use five visually distinct but accessible colors, with the final `마무리` period visually separate from week 4.
- A date gets the unfinished-work state when `calendarTasksForDate` returns one or more tasks with `done !== true`.
- The unfinished state adds a red outline/status dot without replacing the period color. Completed-only dates do not show red.
- Unassigned tasks do not mark any calendar date.

## Home Contract Label Rules

- A client with `contractType === "renewal"` shows `재계약 N회차`.
- `N` comes from a persisted positive integer renewal count. Existing renewal clients without a count display `재계약 1회차` and are normalized on their next save/renewal action.
- All other clients show `신규`.

## Compatibility and Error Handling

- Existing reports lacking `revenue`, existing clients lacking renewal counts, and checklist data without daily fields remain readable.
- Currency inputs accept non-negative whole Korean-won values, strip formatting on save, and show a clear inline validation message for invalid values.
- If there are no usable values for a chart month, the graph is not rendered; no empty zero-value graph appears.
- Revenue changes persist with the report via the existing report storage/index flow; no new storage bucket is added.

## Verification

- Add tests for optional revenue serialization, weekly summing, override precedence, prior-month comparison, and hide-when-empty behavior.
- Add tests for period color markers and the red unfinished-date state, including completed and unassigned-task cases.
- Add tests for home contract labels and legacy renewal fallback.
- Run all existing static Node tests, then manually verify report entry, calendar status, and responsive chart layout in the browser before production deployment.
