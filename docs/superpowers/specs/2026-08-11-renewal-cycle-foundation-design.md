# Renewal Cycle Foundation Design

## Scope

This first phase establishes the contract cycle rules that later calendar, checklist, revenue, and contract features will rely on.

It covers:

- New contract start dates must be Mondays.
- Renewal processing starts a new cycle instead of continuing the previous cycle in place.
- Renewal processing defaults the next cycle start date to the first Monday after the current contract end date.
- The user may change the renewal cycle start date, but only to another Monday.
- After choosing the renewal start date, the dashboard asks which checklist set should be applied to the new cycle.
- Existing reports, revenue, notes, information guide links, and historic checklist records are preserved.
- Current progress and active checklist state are reset for the new cycle.

It does not cover the later contract-generation/signature feature, home dashboard redesign, or the complete revenue-history redesign.

## User Flow

### New Client

When creating or editing a client whose contract type is `new`, the start date field accepts only Mondays.

If the selected date is not a Monday, saving is blocked and the user sees a clear inline validation message:

`신규 계약 시작일은 월요일만 선택할 수 있습니다.`

The actual saved `startDate` remains the business contract start date. There is no hidden weekday adjustment.

### Renewal

When the user clicks `재계약 처리`, the existing confirm-only flow becomes a two-step modal.

Step 1: choose the next cycle start date.

- Default value: the first Monday after the current contract end date.
- If no contract end date can be calculated, default to the next Monday after today.
- Only Mondays are valid.

Step 2: choose the checklist setup for the new cycle.

- Show existing shared checklist sets.
- Include an explicit option: `세트 없이 시작`.
- If a set is selected, generate fresh checklist tasks for the new cycle.
- If no set is selected, the new active checklist starts empty.

The final action confirms the renewal.

## Data Model

The existing client object remains the source of truth. Phase 1 extends it without migrating old records aggressively.

Client fields:

- `contractType`: `"new"` or `"renewal"`.
- `renewalCount`: positive integer for renewal clients.
- `startDate`: current active cycle start date. Must be a Monday after this phase.
- `previousCycles`: optional array of archived cycle snapshots.

Each `previousCycles` item contains:

- `cycleNumber`: number.
- `contractType`: string.
- `startDate`: string.
- `contractMonths`: string or number copied from the client at renewal time.
- `checklist`: array copied from the active checklist before reset.
- `progress`: object copied from legacy progress before reset, if present.
- `archivedAt`: timestamp.

The active client keeps:

- `checklist`: the fresh current-cycle checklist.
- `progress`: reset to an empty object.
- `dailyNotes`: preserved for now, because notes are date-based history.
- `reports`, `revenue`, and guide data: unchanged and preserved by their existing keys.

## Checklist Set Application

Checklist set application reuses the existing daily checklist set structure.

Rules:

- Daily tasks remain source-ordered.
- Multiple tasks on the same day are supported.
- Legacy week-only tasks remain supported.
- The generated tasks are fresh copies with new IDs and `done: false`.
- The selected set is not mutated.
- The new cycle start date is passed to existing date/day helpers for calendar rendering.

Weekend exclusion is not implemented in Phase 1. Phase 1 only makes the renewal flow choose the set; weekend exclusion is a Phase 2 calendar/checklist calculation change.

## Calendar And Progress Impact

After renewal:

- Home progress gauge and client detail calendar use the new `startDate`.
- The current active cycle starts at day 1.
- Old checklist completion does not count toward the new cycle.
- Old checklist state remains available inside `previousCycles`.

Existing historic reports and revenue entries keep their original dates and are not recalculated in Phase 1.

## Error Handling

If renewal step 1 has a non-Monday date, the final button is disabled or save is blocked with:

`재계약 시작일은 월요일만 선택할 수 있습니다.`

If checklist sets fail to load, the modal still allows `세트 없이 시작`.

If saving the renewal fails:

- The client object must not be partially updated in memory.
- The modal remains open.
- The user sees the existing save failure toast style.

## Testing

Add regression coverage for:

- New client save rejects non-Monday start dates.
- New client save accepts Monday start dates.
- Renewal default date is the Monday after contract end.
- Renewal rejects non-Monday dates.
- Renewal increments `renewalCount`.
- Renewal archives the active checklist/progress into `previousCycles`.
- Renewal resets active checklist/progress.
- Renewal applying a set creates fresh incomplete tasks.
- Renewal with `세트 없이 시작` creates an empty active checklist.
- Existing reports, revenue fields, daily notes, and guide IDs are preserved.

## Release Strategy

Ship Phase 1 independently.

After deployment, verify:

- Existing clients still open.
- A new client with a Monday start date saves.
- A new client with a non-Monday start date is blocked.
- A renewal can be processed with default Monday date and a checklist set.
- The client detail page shows the new cycle as current.

