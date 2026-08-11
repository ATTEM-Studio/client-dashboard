# Calendar Workday Cycle Design

## Scope

Phase 2 improves the client schedule calendar after the renewal-cycle foundation.

It covers:

- Add a per-client weekend exclusion setting.
- New clients default to excluding weekends.
- Existing clients without the setting keep the old calendar-day behavior.
- Checklist date matching can use workday ordinals when weekend exclusion is enabled.
- Calendar displays weekends and out-of-cycle dates with softer gray treatment.
- Current unfinished-task red outline remains visible.
- Ended cycle dates can still be opened for read/note review; the visual treatment changes, not access.

It does not cover checklist accordion redesign, revenue history redesign, home dashboard redesign, or contract generation/signature.

## Weekend Exclusion Rule

Client field:

- `excludeWeekends`: boolean.

Rules:

- New client forms default `excludeWeekends` to `true`.
- Existing clients with no `excludeWeekends` are treated as `false`.
- When `excludeWeekends === true`, day-based checklist tasks use workdays only.
- Saturday and Sunday do not increment the checklist day ordinal.
- The start date is already Monday from Phase 1, so day 1 is Monday.

Example:

- Monday: day 1
- Tuesday: day 2
- Wednesday: day 3
- Thursday: day 4
- Friday: day 5
- Saturday/Sunday: no checklist day
- Next Monday: day 6

## Calendar Periods

The existing 4-week plus closing model remains.

When weekend exclusion is off:

- Existing 30-calendar-day behavior remains.
- 1주차 is days 1-7.
- 2주차 is days 8-14.
- 3주차 is days 15-21.
- 4주차 is days 22-28.
- 마무리 is days 29-30.

When weekend exclusion is on:

- The same period labels are based on workday ordinals.
- 1주차 is workdays 1-5.
- 2주차 is workdays 6-10.
- 3주차 is workdays 11-15.
- 4주차 is workdays 16-20.
- 마무리 is workdays 21-22.
- Weekend cells remain visible but do not receive a checklist period unless they have a note.

## Visual Treatment

Calendar day classes:

- `is-weekend`: weekend cell, softly muted when weekend exclusion is enabled.
- `is-outside-cycle`: date is outside the active cycle range.
- `is-ended-cycle`: date belongs to an archived previous cycle.

Visual rules:

- Out-of-cycle and ended-cycle days use a light gray background and muted text.
- Period colors remain stronger than the cell background for active cycle dates.
- The unfinished red outline remains prominent even on muted cells.
- Notes remain visible on muted cells.

## Previous Cycles

`previousCycles` from Phase 1 is used only for visual classification in this phase.

If a calendar date falls within an archived previous cycle range:

- The date receives `is-ended-cycle`.
- It does not use current-cycle checklist tasks.
- Clicking the date still opens the existing day modal, but current-cycle task matching may be empty.

Historic checklist detail browsing for archived cycles is out of scope for this phase.

## Data Preservation

This phase must not rewrite existing clients except when the user edits and saves the new `excludeWeekends` setting.

The following data must be preserved:

- `previousCycles`
- `checklist`
- `progress`
- `dailyNotes`
- `reports`
- `revenue`
- `guideId`

## Testing

Add regression coverage for:

- New client form defaults `excludeWeekends` to true.
- Existing client without `excludeWeekends` keeps legacy calendar-day behavior.
- `workdayOrdinal` skips Saturday/Sunday.
- Weekend-exclusion task matching places day 6 on the next Monday, not Saturday.
- Weekend cells are muted when weekend exclusion is enabled.
- Dates after the active workday cycle are marked outside-cycle.
- Dates inside `previousCycles` are marked ended-cycle.
- Unfinished red outline still appears with the muted classes.

## Release Strategy

Ship independently after full regression.

Production verification:

- Existing client calendar remains unchanged unless weekend exclusion is enabled.
- New client save form shows weekend exclusion enabled by default.
- A Monday-start client with weekend exclusion shows weekdays as active workdays.
- Weekend dates appear muted.
- Current unfinished task dates remain red-outlined.

