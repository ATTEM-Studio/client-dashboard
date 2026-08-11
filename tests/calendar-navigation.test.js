process.env.TZ = 'America/New_York';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/(function calendarDateOrdinal[\s\S]*?\n  function calendarTasksForDate[\s\S]*?\n  })/);
assert.ok(match, 'calendar navigation and day-task helpers must exist');

const sandbox = {};
vm.runInNewContext(match[1], sandbox);
assert.strictEqual(sandbox.calendarMonthShift('2026-07', -1), '2026-06');
assert.strictEqual(sandbox.calendarMonthShift('2026-12', 1), '2027-01');
assert.strictEqual(sandbox.calendarMonthShift('2026-01', -1), '2025-12');

const emptySetsMatch = html.match(/(function defaultChecklistSets[\s\S]*?\n  })/);
assert.ok(emptySetsMatch, 'the empty checklist-set state helper must exist');
vm.runInNewContext(emptySetsMatch[1], sandbox);
assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.defaultChecklistSets())), []);

const set = {
  id: 'set-daily',
  items: [
    { text: 'first task on day 3', day: 3 },
    { text: 'second task on day 3', day: 3 },
    { text: 'task on day 4', day: 4 }
  ]
};
const ids = ['task-1', 'task-2', 'task-3'];
const applied = sandbox.cloneChecklistSet(set, () => ids.shift());
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.calendarUnassignedTasks(applied))),
  []
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.calendarTasksForDate('2026-07-30', '2026-08-01', applied))),
  [
    { id: 'task-1', text: 'first task on day 3', day: 3, done: false, setId: 'set-daily' },
    { id: 'task-2', text: 'second task on day 3', day: 3, done: false, setId: 'set-daily' }
  ]
);

const dstTasks = [
  { id: 'dst-day-2', text: 'day two task', day: 2, done: false },
  { id: 'dst-day-3', text: 'day three task', day: 3, done: false },
  { id: 'dst-day-8', text: 'day eight task', day: 8, done: false },
  { id: 'dst-day-15', text: 'day fifteen task', day: 15, done: false },
  { id: 'dst-day-29', text: 'day twenty-nine task', day: 29, done: false },
  { id: 'dst-day-30', text: 'day thirty task', day: 30, done: false },
  { id: 'dst-day-31', text: 'out-of-range task', day: 31, done: false },
  { id: 'dst-legacy-1', text: 'legacy week one task', week: '1', done: false },
  { id: 'dst-legacy-2', text: 'legacy week two task', week: '2', done: false },
  { id: 'dst-legacy-3', text: 'legacy week three task', week: '3', done: false },
  { id: 'dst-legacy-closing', text: 'legacy closing task', week: 'closing', done: false }
];
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.calendarTasksForDate('2026-03-07', '2026-03-09', dstTasks))),
  [
    { id: 'dst-day-3', text: 'day three task', day: 3, done: false },
    { id: 'dst-legacy-1', text: 'legacy week one task', week: '1', done: false }
  ],
  'calendar dates spanning the spring DST boundary must retain their ordinal day'
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.calendarTasksForDate('2026-03-07', '2026-03-14', dstTasks))),
  [
    { id: 'dst-day-8', text: 'day eight task', day: 8, done: false },
    { id: 'dst-legacy-2', text: 'legacy week two task', week: '2', done: false }
  ]
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.calendarTasksForDate('2026-03-07', '2026-03-21', dstTasks))),
  [
    { id: 'dst-day-15', text: 'day fifteen task', day: 15, done: false },
    { id: 'dst-legacy-3', text: 'legacy week three task', week: '3', done: false }
  ]
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.calendarTasksForDate('2026-03-07', '2026-04-04', dstTasks))),
  [
    { id: 'dst-day-29', text: 'day twenty-nine task', day: 29, done: false },
    { id: 'dst-legacy-closing', text: 'legacy closing task', week: 'closing', done: false }
  ]
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.calendarTasksForDate('2026-03-07', '2026-04-05', dstTasks))),
  [
    { id: 'dst-day-30', text: 'day thirty task', day: 30, done: false },
    { id: 'dst-legacy-closing', text: 'legacy closing task', week: 'closing', done: false }
  ]
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.calendarTasksForDate('2026-03-07', '2026-04-06', dstTasks))),
  [],
  'day 31 must not leak into the 30-day calendar range'
);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.calendarTasksForDate('2026-07-30', '2026-08-01', []))),
  []
);

const legacyTasks = [
  { id: 'legacy-1', text: 'week one task', week: '1', done: false },
  { id: 'legacy-2', text: 'week two task', week: '2', done: false },
  { id: 'daily-wins', text: 'day eight task', day: 8, week: '1', done: false }
];
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.calendarTasksForDate('2026-07-30', '2026-08-01', legacyTasks))),
  [{ id: 'legacy-1', text: 'week one task', week: '1', done: false }]
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.calendarTasksForDate('2026-07-30', '2026-08-06', legacyTasks))),
  [
    { id: 'legacy-2', text: 'week two task', week: '2', done: false },
    { id: 'daily-wins', text: 'day eight task', day: 8, week: '1', done: false }
  ]
);

const sixthDayTask = [{ id: 'day-6', text: 'sixth day task', day: 6, done: false }];
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.calendarTasksForDate({ startDate:'2026-08-10', excludeWeekends:true }, '2026-08-17', sixthDayTask))),
  sixthDayTask,
  'a workday-based day 6 task appears on the following Monday'
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.calendarTasksForDate('2026-08-10', '2026-08-15', sixthDayTask))),
  sixthDayTask,
  'legacy cycles continue matching day 6 on Saturday'
);

assert.match(html, /data-calendar-month="prev"/);
assert.match(html, /data-calendar-month="next"/);
assert.match(html, /data-add-task/);
assert.match(html, /data-del-work/);
assert.match(html, /id="btn-renew"/);
assert.match(html, /id="daily-note"/);
assert.match(html, /id="day-save"/);
assert.match(html, /confirmDialog\("리포트를 삭제할까요\?"/);
console.log('calendar navigation and workspace controls: ok');
