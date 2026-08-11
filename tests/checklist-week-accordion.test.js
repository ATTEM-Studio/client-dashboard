const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');

function functionSource(name) {
  const match = html.match(new RegExp(
    '(^  (?:async )?function ' + name + '\\([\\s\\S]*?)(?=\\n  (?:async )?function |\\n  /\\*)',
    'm'
  ));
  assert.ok(match, name + ' helper must exist in index.html');
  return match[1];
}

const sandbox = {
  state: { setCollectionOpen: false, checklistWeeksOpen: { '1': true, closing: true } },
  esc(value) { return String(value == null ? '' : value); },
  checklistSetCollectionPanel() { return '<div class="sets"></div>'; }
};

vm.runInNewContext([
  functionSource('calendarDateOrdinal'),
  functionSource('calendarDayOrdinal'),
  functionSource('isWeekendDate'),
  functionSource('workdayOrdinal'),
  functionSource('cycleDayOrdinal'),
  functionSource('checklistPeriod'),
  functionSource('dailyPeriod'),
  functionSource('periodLabel'),
  functionSource('isoDate'),
  functionSource('isoFromUtcDate'),
  functionSource('checklistTaskPeriod'),
  functionSource('checklistSections'),
  functionSource('checklistPanel')
].join('\n'), sandbox);

const client = {
  startDate: '2026-08-10',
  excludeWeekends: true,
  checklist: [
    { id: 'day-1', day: 1, text: 'first workday', done: true },
    { id: 'day-2', day: 2, text: 'second workday', done: false },
    { id: 'legacy-2', week: '2', text: 'legacy second week', done: false },
    { id: 'closing', day: 29, text: 'closing task', done: false },
    { id: 'none', week: '', text: 'unassigned task', done: false }
  ]
};

const rendered = sandbox.checklistPanel(client, client.checklist, 1);

assert.match(rendered, /class="check-section/);
assert.match(rendered, /data-toggle-check-section="1"[^>]*aria-expanded="true"/);
assert.match(rendered, /1주차[\s\S]*1 \/ 2 완료/);
assert.match(rendered, /first workday[\s\S]*second workday/);
assert.match(rendered, /data-toggle-check-section="2"[^>]*aria-expanded="false"/);
assert.doesNotMatch(rendered, /legacy second week[\s\S]*data-toggle-work="legacy-2"/,
  'collapsed week sections must hide their task rows until toggled open');
assert.match(rendered, /data-toggle-check-section="closing"[^>]*aria-expanded="true"/);
assert.match(rendered, /마무리[\s\S]*closing task/);
assert.match(rendered, /data-toggle-check-section="unassigned"/);
assert.match(rendered, /미배정[\s\S]*unassigned task/);
assert.match(rendered, /data-toggle-work="day-1"/);
assert.match(rendered, /data-del-work="day-1"/);
assert.match(rendered, /data-add-task/);

console.log('checklist week accordion: ok');
