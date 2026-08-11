process.env.TZ = 'America/New_York';

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

function json(value) {
  return JSON.parse(JSON.stringify(value));
}

async function main() {
  const helperSandbox = {};
  vm.runInNewContext([
    functionSource('calendarDateOrdinal'),
    functionSource('calendarDayOrdinal'),
    functionSource('dailyPeriod'),
    functionSource('calendarTasksForDate'),
    functionSource('contractLabel'),
    functionSource('calendarPeriodClass'),
    functionSource('calendarDateHasUnfinishedTasks')
  ].join('\n'), helperSandbox);

  assert.strictEqual(helperSandbox.contractLabel({ contractType: 'new' }), '신규');
  assert.strictEqual(helperSandbox.contractLabel({ contractType: 'renewal' }), '재계약 1회차');
  assert.strictEqual(helperSandbox.contractLabel({ contractType: 'renewal', renewalCount: 3 }), '재계약 3회차');
  assert.strictEqual(helperSandbox.contractLabel({ contractType: 'renewal', renewalCount: 0 }), '재계약 1회차');

  assert.strictEqual(helperSandbox.calendarPeriodClass('1'), 'period-1');
  assert.strictEqual(helperSandbox.calendarPeriodClass('2'), 'period-2');
  assert.strictEqual(helperSandbox.calendarPeriodClass('3'), 'period-3');
  assert.strictEqual(helperSandbox.calendarPeriodClass('4'), 'period-4');
  assert.strictEqual(helperSandbox.calendarPeriodClass('closing'), 'period-closing');
  assert.strictEqual(helperSandbox.calendarPeriodClass(''), '');

  assert.strictEqual(helperSandbox.calendarDateHasUnfinishedTasks('2026-07-22', '2026-07-22', [
    { id: 'a', day: 1, done: false }
  ]), true);
  assert.strictEqual(helperSandbox.calendarDateHasUnfinishedTasks('2026-07-22', '2026-07-22', [
    { id: 'a', day: 1, done: true },
    { id: 'b', week: '', done: false }
  ]), false, 'completed-only and unassigned work must not mark a date');
  assert.strictEqual(helperSandbox.calendarDateHasUnfinishedTasks('2026-07-22', '2026-07-29', [
    { id: 'legacy', week: '2', done: false }
  ]), true, 'assigned legacy week tasks remain supported');
  assert.strictEqual(helperSandbox.calendarDateHasUnfinishedTasks('2026-07-22', '2026-08-21', [
    { id: 'outside', day: 31, done: false }
  ]), false, 'tasks outside the 30-day calendar range must not mark a date');

  const calendarSandbox = {
    state: { calendarMonth: '2026-07' },
    esc: (value) => String(value == null ? '' : value),
    monthKey: (date) => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0')
  };
  vm.runInNewContext([
    functionSource('calendarDateOrdinal'),
    functionSource('calendarDayOrdinal'),
    functionSource('checklistPeriod'),
    functionSource('dailyPeriod'),
    functionSource('calendarUnassignedTasks'),
    functionSource('calendarTasksForDate'),
    functionSource('calendarPeriodClass'),
    functionSource('calendarDateHasUnfinishedTasks'),
    functionSource('periodLabel'),
    functionSource('isoDate'),
    functionSource('calendarPanel')
  ].join('\n'), calendarSandbox);

  const client = {
    startDate: '2026-07-22',
    dailyNotes: {},
    checklist: [
      { id: 'open-day-1', day: 1, done: false },
      { id: 'done-day-2', day: 2, done: true },
      { id: 'unassigned', week: '', done: false },
      { id: 'open-week-2', week: '2', done: false },
      { id: 'open-day-22', day: 22, done: false },
      { id: 'open-day-29', day: 29, done: false }
    ]
  };
  let rendered = calendarSandbox.calendarPanel(client);
  assert.match(rendered, /class="calendar-day period-1 has-unfinished" data-day="2026-07-22"/);
  assert.match(rendered, /class="calendar-day period-1" data-day="2026-07-23"/);
  assert.match(rendered, /class="calendar-day period-2 has-unfinished" data-day="2026-07-29"/);
  assert.doesNotMatch(rendered, /has-unfinished" data-day="2026-07-24"/, 'unassigned work must not mark arbitrary dates');

  calendarSandbox.state.calendarMonth = '2026-08';
  rendered = calendarSandbox.calendarPanel(client);
  assert.match(rendered, /class="calendar-day period-4 has-unfinished" data-day="2026-08-12"/);
  assert.match(rendered, /class="calendar-day period-closing has-unfinished" data-day="2026-08-19"/);
  assert.match(rendered, /class="calendar-day " data-day="2026-08-21"/);

  ['period-1', 'period-2', 'period-3', 'period-4', 'period-closing'].forEach((className) => {
    assert.match(html, new RegExp('\\.calendar-day\\.' + className + '\\{[^}]*background:'), className + ' needs a full-cell background');
    assert.match(html, new RegExp('\\.calendar-day\\.' + className + ' \\.period\\{[^}]*background:'), className + ' needs a matching period badge');
  });
  assert.match(html, /\.calendar-day\.has-unfinished\{[^}]*outline:/, 'unfinished dates need a red outline');
  assert.match(html, /\.calendar-day\.has-unfinished::before\{[^}]*background:/, 'unfinished dates need a visible dot');

  const body = { innerHTML: '', querySelectorAll: () => [] };
  const dashboardSandbox = {
    state: { month: '2026-07' },
    document: { getElementById: (id) => id === 'dash-body' ? body : null },
    loadAllClients: async () => [
      { id: 'new', name: 'New Co', contractType: 'new', status: 'active' },
      { id: 'legacy', name: 'Legacy Co', contractType: 'renewal', status: 'active' },
      { id: 'third', name: 'Third Co', contractType: 'renewal', renewalCount: 3, status: 'active' }
    ],
    progressOf: () => ({ total: 0, done: 0 }),
    isNewIn: () => false,
    renewalsIn: () => 0,
    monthLabel: () => '2026년 7월',
    esc: (value) => String(value == null ? '' : value),
    thirtyDayProgress: () => ({ state: 'missing' }),
    contractEndKey: () => null
  };
  vm.runInNewContext([
    functionSource('contractLabel'),
    functionSource('fillDashboard')
  ].join('\n'), dashboardSandbox);
  await dashboardSandbox.fillDashboard();
  assert.match(body.innerHTML, /New Co<span class="tag tag-new">신규<\/span>/);
  assert.match(body.innerHTML, /Legacy Co<span class="tag tag-renew">재계약 1회차<\/span>/);
  assert.match(body.innerHTML, /Third Co<span class="tag tag-renew">재계약 3회차<\/span>/);

  const renewed = { id: 'client-1', contractType: 'new' };
  const saved = [];
  const renewalSandbox = {
    state: { month: '2026-07' },
    getS: async () => renewed,
    saveClientAndRefresh: async (clientValue) => saved.push(json(clientValue)),
    showToast: () => {}
  };
  vm.runInNewContext(functionSource('markRenewal'), renewalSandbox);
  await renewalSandbox.markRenewal('client-1');
  assert.strictEqual(saved[0].renewalCount, 1, 'the first renewal action must persist renewalCount 1');
  await renewalSandbox.markRenewal('client-1');
  assert.strictEqual(saved[1].renewalCount, 2, 'later renewal actions must increment and persist renewalCount');

  const renewalTransformationSandbox = {};
  vm.runInNewContext([
    functionSource('buildRenewalClient'),
    functionSource('contractEndDate'),
    functionSource('checklistTasksFromSet'),
    functionSource('uid'),
    functionSource('parseIsoDateParts'),
    functionSource('isoFromUtcDate')
  ].join('\n'), renewalTransformationSandbox);

  const renewalClient = {
    id: 'client-1',
    contractType: 'new',
    renewalCount: 0,
    startDate: '2026-08-10',
    contractMonths: '1',
    checklist: [{ id: 'old-task', text: 'old', done: true }],
    progress: { '1': 'done' },
    dailyNotes: { '2026-08-11': 'note' },
    guideId: 'guide_keep',
    revenue: { weekly: 1000 }
  };
  const set = {
    id: 'set-1',
    name: 'Basic',
    items: [{ day: 1, text: 'new task' }, { week: '2', text: 'legacy week task' }]
  };
  const transformed = renewalTransformationSandbox.buildRenewalClient(renewalClient, '2026-09-14', set);
  assert.strictEqual(renewalTransformationSandbox.contractEndDate(renewalClient), '2026-09-09');
  assert.strictEqual(transformed.contractType, 'renewal');
  assert.strictEqual(transformed.renewalCount, 1);
  assert.strictEqual(transformed.startDate, '2026-09-14');
  assert.deepStrictEqual(json(transformed.progress), {});
  assert.strictEqual(transformed.dailyNotes['2026-08-11'], 'note');
  assert.strictEqual(transformed.guideId, 'guide_keep');
  assert.deepStrictEqual(json(transformed.revenue), { weekly: 1000 });
  assert.strictEqual(transformed.previousCycles.length, 1);
  assert.deepStrictEqual(json(transformed.previousCycles[0].checklist), [{ id: 'old-task', text: 'old', done: true }]);
  assert.strictEqual(transformed.checklist.length, 2);
  assert.strictEqual(transformed.checklist.every((task) => task.done === false), true);
  assert.notStrictEqual(transformed.checklist[0].id, 'old-task');
  assert.deepStrictEqual(
    json(renewalTransformationSandbox.buildRenewalClient(renewalClient, '2026-09-14', null).checklist),
    []
  );

  console.log('calendar status and contract labels: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
