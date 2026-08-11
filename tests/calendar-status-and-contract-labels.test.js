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
    functionSource('isWeekendDate'),
    functionSource('workdayOrdinal'),
    functionSource('cycleDayOrdinal'),
    functionSource('checklistPeriod'),
    functionSource('cycleLength'),
    functionSource('clientPreviousCycleContainsDate'),
    functionSource('calendarDateState'),
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

  const weekendState = helperSandbox.calendarDateState({ startDate: '2026-08-10', excludeWeekends: true }, '2026-08-15');
  assert.strictEqual(weekendState.isWeekend, true);
  assert.strictEqual(weekendState.period, null);
  assert.strictEqual(weekendState.isOutsideCycle, false);

  const outsideState = helperSandbox.calendarDateState({ startDate: '2026-08-10', excludeWeekends: true }, '2026-09-09');
  assert.strictEqual(outsideState.isOutsideCycle, true);

  const endedState = helperSandbox.calendarDateState({
    startDate: '2026-09-14',
    excludeWeekends: true,
    previousCycles: [{ startDate: '2026-08-10' }]
  }, '2026-08-11');
  assert.strictEqual(endedState.isEndedCycle, true);

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
    functionSource('isWeekendDate'),
    functionSource('workdayOrdinal'),
    functionSource('cycleDayOrdinal'),
    functionSource('checklistPeriod'),
    functionSource('cycleLength'),
    functionSource('clientPreviousCycleContainsDate'),
    functionSource('calendarDateState'),
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
  assert.match(rendered, /class="calendar-day is-outside-cycle" data-day="2026-08-21"/);

  calendarSandbox.state.calendarMonth = '2026-09';
  rendered = calendarSandbox.calendarPanel({
    startDate: '2026-08-10',
    excludeWeekends: true,
    dailyNotes: {},
    checklist: [{ id: 'open-day-1', day: 1, done: false }]
  });
  assert.match(rendered, /class="calendar-day is-weekend" data-day="2026-09-05"/);
  assert.match(rendered, /class="calendar-day is-outside-cycle" data-day="2026-09-09"/);

  calendarSandbox.state.calendarMonth = '2026-08';
  rendered = calendarSandbox.calendarPanel({
    startDate: '2026-09-14',
    excludeWeekends: true,
    previousCycles: [{ startDate: '2026-08-10' }],
    dailyNotes: {},
    checklist: []
  });
  assert.match(rendered, /class="calendar-day is-ended-cycle" data-day="2026-08-11"/);

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

  // Break caught: removing the renewal dialog's selected-set save flow would leave the current client unchanged.
  const renewalNodes = {};
  function renewalNode(attributes = {}) {
    return Object.assign({
      hidden: false,
      value: '',
      onclick: null,
      classList: { shown: false, add(){ this.shown = true; }, remove(){ this.shown = false; }, toggle(){} }
    }, attributes);
  }
  const setButtons = [
    renewalNode({ getAttribute: () => '', classList: { toggle(){} } }),
    renewalNode({ getAttribute: () => 'set-1', classList: { toggle(){} } })
  ];
  renewalNodes['renewal-modal'] = renewalNode();
  renewalNodes['renewal-date-step'] = renewalNode();
  renewalNodes['renewal-set-step'] = renewalNode();
  renewalNodes['renewal-start-date'] = renewalNode();
  renewalNodes['renewal-set-options'] = renewalNode({
    querySelectorAll: () => setButtons,
    set innerHTML(value){ this.rendered = value; }
  });
  ['btn-cancel-renewal', 'btn-next-renewal', 'btn-back-renewal', 'btn-confirm-renewal'].forEach((id) => {
    renewalNodes[id] = renewalNode();
  });
  const savedRenewals = [];
  const savedIndexes = [];
  const renewalSandbox = {
    state: { month: '2026-09', checklistSets: [{ id: 'set-1', name: 'Basic' }], clients: [{ id: 'client-1', name: 'Client' }] },
    document: { getElementById: (id) => renewalNodes[id] },
    contractEndDate: () => '2026-09-09',
    nextMondayAfter: () => '2026-09-14',
    isoDate: () => 'unused',
    esc: (value) => String(value),
    isMondayDate: (value) => value === '2026-09-14',
    buildRenewalClient: (client, startDate, set) => ({
      id: client.id,
      name: client.name,
      contractType: 'renewal',
      startDate,
      updatedAt: 123,
      setId: set && set.id
    }),
    setS: async (key, value) => { savedRenewals.push({ key, value: json(value) }); return true; },
    setP: async (key, value) => { savedIndexes.push({ key, value: json(value) }); return true; },
    renderClientWorkspace: (client) => { renewalSandbox.renderedClient = json(client); },
    showToast: () => {}
  };
  vm.runInNewContext(functionSource('renewalDialog'), renewalSandbox);
  renewalSandbox.renewalDialog({ id: 'client-1', name: 'Client', status: 'ended', renewals: [] });
  assert.strictEqual(renewalNodes['renewal-start-date'].value, '2026-09-14', 'renewal must default to the Monday after the current contract ends');
  assert.strictEqual(renewalNodes['renewal-modal'].classList.shown, true, 'renewal dialog must open before saving');
  renewalNodes['btn-next-renewal'].onclick();
  setButtons[1].onclick();
  await renewalNodes['btn-confirm-renewal'].onclick();
  assert.deepStrictEqual(savedRenewals, [{ key: 'client:client-1', value: { id: 'client-1', name: 'Client', contractType: 'renewal', startDate: '2026-09-14', updatedAt: 123, setId: 'set-1', renewals: ['2026-09'], status: 'active' } }]);
  assert.deepStrictEqual(savedIndexes, [{ key: 'clients-index', value: [{ id: 'client-1', name: 'Client', contractType: 'renewal', startDate: '2026-09-14', status: 'active', updatedAt: 123 }] }],
    'renewal must preserve the lightweight client-index shape');
  assert.deepStrictEqual(renewalSandbox.renderedClient, { id: 'client-1', name: 'Client', contractType: 'renewal', startDate: '2026-09-14', updatedAt: 123, setId: 'set-1', renewals: ['2026-09'], status: 'active' });
  const priorCurrentClient = { id: 'client-1', name: 'Prior client' };
  const priorClients = [{ id: 'client-1', name: 'Prior client' }];
  renewalSandbox.state.currentClient = priorCurrentClient;
  renewalSandbox.state.clients = priorClients;
  renewalSandbox.renderedClient = undefined;
  renewalSandbox.setS = async () => false;
  renewalSandbox.renewalDialog({ id: 'client-1', name: 'Client' });
  renewalNodes['btn-next-renewal'].onclick();
  await renewalNodes['btn-confirm-renewal'].onclick();
  assert.strictEqual(renewalNodes['renewal-modal'].classList.shown, true, 'a failed renewal save must keep the dialog open');
  renewalSandbox.setS = async () => true;
  renewalSandbox.setP = async () => false;
  renewalSandbox.renewalDialog({ id: 'client-1', name: 'Client' });
  renewalNodes['btn-next-renewal'].onclick();
  await renewalNodes['btn-confirm-renewal'].onclick();
  assert.strictEqual(renewalNodes['renewal-modal'].classList.shown, true, 'an index write failure must keep the dialog open');
  assert.strictEqual(renewalSandbox.state.currentClient, priorCurrentClient,
    'an index write failure must not replace the current client in memory');
  assert.strictEqual(renewalSandbox.state.clients, priorClients,
    'an index write failure must not replace the client index in memory');
  assert.strictEqual(renewalSandbox.renderedClient, undefined,
    'an index write failure must not render the renewed client');

  const renewalTransformationSandbox = {};
  vm.runInNewContext([
    functionSource('buildRenewalClient'),
    functionSource('contractEndDate'),
    functionSource('checklistTasksFromSet'),
    functionSource('uid'),
    functionSource('parseIsoDateParts'),
    functionSource('isoFromUtcDate'),
    functionSource('nextMondayAfter')
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
  assert.strictEqual(
    renewalTransformationSandbox.contractEndDate(Object.assign({}, renewalClient, { contractMonths: 'abc' })),
    '2026-09-09',
    'non-numeric contract months must default to one month'
  );
  assert.strictEqual(
    renewalTransformationSandbox.contractEndDate({ startDate: '2022-01-31', contractMonths: '1' }),
    '2022-02-27',
    'month-end starts must end on the day before the clamped monthly anniversary'
  );
  assert.strictEqual(
    renewalTransformationSandbox.nextMondayAfter('2022-02-27'),
    '2022-02-28',
    'renewal defaults must use the Monday immediately after a month-end contract'
  );
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
  ['abc', '2.5'].forEach((renewalCount) => {
    const legacyRenewal = Object.assign({}, renewalClient, { contractType: 'renewal', renewalCount });
    const normalized = renewalTransformationSandbox.buildRenewalClient(legacyRenewal, '2026-09-14', null);
    assert.strictEqual(normalized.renewalCount, 1,
      'invalid renewal counts must restart at the first positive integer renewal');
    assert.strictEqual(normalized.previousCycles[0].cycleNumber, 1,
      'archived cycle numbers must remain positive integers');
  });

  console.log('calendar status and contract labels: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
