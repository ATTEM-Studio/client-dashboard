process.env.TZ = 'America/New_York';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/(function calendarDateOrdinal[\s\S]*?\n  function checklistPeriod[\s\S]*?\n  }\n  function dailyPeriod[\s\S]*?\n  }[\s\S]*?\n\n  function cloneChecklistSet[\s\S]*?\n  })/);
assert.ok(match, 'calendar and checklist-set helpers must exist in index.html');

const sandbox = {};
vm.runInNewContext(match[1], sandbox);

assert.strictEqual(sandbox.checklistPeriod('2026-07-22', '2026-07-22'), '1');
assert.strictEqual(sandbox.checklistPeriod('2026-07-22', '2026-07-29'), '2');
assert.strictEqual(sandbox.checklistPeriod('2026-07-22', '2026-08-12'), '4');
assert.strictEqual(sandbox.checklistPeriod('2026-07-22', '2026-08-19'), 'closing');
assert.strictEqual(sandbox.checklistPeriod('2026-07-22', '2026-08-20'), 'closing');
assert.strictEqual(sandbox.checklistPeriod('2026-07-22', '2026-08-21'), null);
assert.strictEqual(sandbox.checklistPeriod('', '2026-08-10'), null);

assert.strictEqual(sandbox.checklistPeriod('2026-03-07', '2026-03-13'), '1');
assert.strictEqual(sandbox.checklistPeriod('2026-03-07', '2026-03-14'), '2', 'the eighth calendar day remains week 2 across spring DST');
assert.strictEqual(sandbox.checklistPeriod('2026-03-07', '2026-03-21'), '3', 'the fifteenth calendar day remains week 3 across spring DST');
assert.strictEqual(sandbox.checklistPeriod('2026-03-07', '2026-04-04'), 'closing', 'day 29 is in the closing period');
assert.strictEqual(sandbox.checklistPeriod('2026-03-07', '2026-04-05'), 'closing', 'day 30 is in the closing period');
assert.strictEqual(sandbox.checklistPeriod('2026-03-07', '2026-04-06'), null, 'day 31 is outside the checklist range');

assert.strictEqual(sandbox.isWeekendDate('2026-08-15'), true);
assert.strictEqual(sandbox.isWeekendDate('2026-08-17'), false);
assert.strictEqual(sandbox.workdayOrdinal('2026-08-10', '2026-08-10'), 1);
assert.strictEqual(sandbox.workdayOrdinal('2026-08-10', '2026-08-14'), 5);
assert.strictEqual(sandbox.workdayOrdinal('2026-08-10', '2026-08-15'), null);
assert.strictEqual(sandbox.workdayOrdinal('2026-08-10', '2026-08-17'), 6);
assert.strictEqual(sandbox.cycleDayOrdinal({ startDate:'2026-08-10', excludeWeekends:true }, '2026-08-17'), 6);
assert.strictEqual(sandbox.cycleDayOrdinal({ startDate:'2026-08-10' }, '2026-08-17'), 8);
assert.strictEqual(sandbox.checklistPeriod({ startDate:'2026-08-10', excludeWeekends:true }, '2026-08-14'), '1');
assert.strictEqual(sandbox.checklistPeriod({ startDate:'2026-08-10', excludeWeekends:true }, '2026-08-17'), '2');
assert.strictEqual(sandbox.checklistPeriod({ startDate:'2026-08-10', excludeWeekends:true }, '2026-09-09'), null, 'the twenty-third workday is outside the cycle');

assert.strictEqual(sandbox.dailyPeriod(1), '1');
assert.strictEqual(sandbox.dailyPeriod(7), '1');
assert.strictEqual(sandbox.dailyPeriod(8), '2');
assert.strictEqual(sandbox.dailyPeriod(28), '4');
assert.strictEqual(sandbox.dailyPeriod(29), 'closing');
assert.strictEqual(sandbox.dailyPeriod(30), 'closing');
assert.strictEqual(sandbox.dailyPeriod(0), null);
assert.strictEqual(sandbox.dailyPeriod(31), null);
assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.checklistSetPeriodDays('1', true))), [1, 2, 3, 4, 5],
  'weekend-aware checklist sets must define week 1 by five workdays');
assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.checklistSetPeriodDays('4', true))), [16, 17, 18, 19, 20],
  'weekend-aware checklist sets must keep week 4 to workdays 16-20');
assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.checklistSetPeriodDays('closing', true))), [21, 22],
  'weekend-aware checklist sets must use workdays 21-22 as the closing period');
assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.checklistSetPeriodDays('1', false))), [1, 2, 3, 4, 5, 6, 7],
  'calendar-day checklist sets must preserve the old seven-day weekly layout');
assert.match(html, /id="set-editor-exclude-weekends"[\s\S]*checked/,
  'new checklist sets must default to weekend exclusion in the editor');

const source = { id: 'set-1', items: [{ text: 'legacy task', week: '1' }] };
const copied = sandbox.cloneChecklistSet(source, () => 'task-1');
assert.deepStrictEqual(JSON.parse(JSON.stringify(copied)), [{ id: 'task-1', text: 'legacy task', week: '1', done: false, setId: 'set-1' }]);
copied[0].text = 'changed legacy task';
assert.strictEqual(source.items[0].text, 'legacy task');

const dailySource = { id: 'set-daily', items: [
  { text: 'first day task', day: 1 },
  { text: 'another first day task', day: 1 },
  { text: 'closing task', day: 29 }
] };
const dailyIds = ['daily-1', 'daily-2', 'daily-3'];
const dailyCopied = sandbox.cloneChecklistSet(dailySource, () => dailyIds.shift());
assert.deepStrictEqual(JSON.parse(JSON.stringify(dailyCopied)), [
  { id: 'daily-1', text: 'first day task', day: 1, done: false, setId: 'set-daily' },
  { id: 'daily-2', text: 'another first day task', day: 1, done: false, setId: 'set-daily' },
  { id: 'daily-3', text: 'closing task', day: 29, done: false, setId: 'set-daily' }
]);
dailyCopied[0].text = 'changed task';
assert.strictEqual(dailySource.items[0].text, 'first day task');

assert.strictEqual(typeof sandbox.moveChecklistSetTask, 'function', 'daily-set tasks must expose a reorder operation');
assert.strictEqual(typeof sandbox.checklistSetItemsForSave, 'function', 'set saving must preserve the draft item sequence');
const reorderDraft = [
  { text: ' first task ', day: 1 },
  { text: 'day two task', day: 2 },
  { text: 'second task', day: 1 },
  { text: 'third task', day: 1 },
  { text: 'legacy task', week: '1' },
  { text: '   ', day: 1 }
];
assert.strictEqual(sandbox.moveChecklistSetTask(reorderDraft, 2, -1), true);
assert.deepStrictEqual(
  reorderDraft.filter((item) => item.day === 1).map((item) => item.text),
  ['second task', ' first task ', 'third task', '   '],
  'move up must change only the selected day sequence'
);
assert.strictEqual(sandbox.moveChecklistSetTask(reorderDraft, 0, -1), false, 'the first task of a day cannot move above its boundary');
assert.strictEqual(sandbox.moveChecklistSetTask(reorderDraft, 2, 1), true);
assert.deepStrictEqual(
  reorderDraft.filter((item) => item.day === 1).map((item) => item.text),
  ['second task', 'third task', ' first task ', '   ']
);
assert.strictEqual(sandbox.moveChecklistSetTask(reorderDraft, 4, 1), false, 'legacy week tasks are not daily reorder targets');

const savedItems = sandbox.checklistSetItemsForSave(reorderDraft);
assert.deepStrictEqual(JSON.parse(JSON.stringify(savedItems)), [
  { text: 'second task', day: 1 },
  { text: 'day two task', day: 2 },
  { text: 'third task', day: 1 },
  { text: 'first task', day: 1 },
  { text: 'legacy task', week: '1' }
]);
const appliedAfterSave = sandbox.cloneChecklistSet(
  { id: 'saved-set', items: savedItems },
  (() => { let id = 0; return () => `saved-${++id}`; })()
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(appliedAfterSave.filter((item) => item.day === 1).map((item) => item.text))),
  ['second task', 'third task', 'first task'],
  'the per-day order must survive save and apply'
);

console.log('calendar and checklist-set helpers: ok');
