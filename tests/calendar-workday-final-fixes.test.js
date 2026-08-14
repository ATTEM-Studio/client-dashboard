const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');

function functionSource(name) {
  const match = html.match(new RegExp(
    '(^  (?:async )?function ' + name + '\\([\\s\\S]*?)(?=\\n  (?:async )?function |\\n  /\\*)',
    'm'
  ));
  assert.ok(match, name + ' must exist in index.html');
  return match[1];
}

function json(value) {
  return JSON.parse(JSON.stringify(value));
}

const calendarSandbox = {};
vm.runInNewContext([
  functionSource('calendarDateOrdinal'),
  functionSource('calendarDayOrdinal'),
  functionSource('isWeekendDate'),
  functionSource('workdayOrdinal'),
  functionSource('cycleDayOrdinal'),
  functionSource('checklistPeriod'),
  functionSource('cycleLength'),
  functionSource('cycleContainsDate'),
  functionSource('clientPreviousCycleContainsDate'),
  functionSource('calendarDateState'),
  functionSource('dailyPeriod'),
  functionSource('calendarTasksForDate'),
  functionSource('calendarUnassignedTasks')
].join('\n'), calendarSandbox);

// Break caught: passing the start-date string to the day modal makes day 6 land on Saturday.
const dayModalNodes = {};
const dayModalSandbox = {
  checklistPeriod: calendarSandbox.checklistPeriod,
  calendarTasksForDate: calendarSandbox.calendarTasksForDate,
  calendarUnassignedTasks: calendarSandbox.calendarUnassignedTasks,
  periodLabel: (period) => period,
  esc: (value) => String(value == null ? '' : value),
  window: { innerWidth: 1000, innerHeight: 700 },
  document: {
    createElement() {
      return { style: { setProperty(name, value) { this[name] = value; } }, remove() {} };
    },
    body: { appendChild(layer) { dayModalNodes.layer = layer; } },
    getElementById(id) {
      if (!dayModalNodes[id]) dayModalNodes[id] = { onclick: null, value: '' };
      return dayModalNodes[id];
    }
  }
};
vm.runInNewContext([
  functionSource('setModalOrigin'),
  functionSource('openDayModal')
].join('\n'), dayModalSandbox);
const workdayClient = {
  startDate: '2026-08-10',
  excludeWeekends: true,
  checklist: [{ id: 'day-6', text: 'sixth workday task', day: 6, done: false }],
  dailyNotes: {}
};
dayModalSandbox.openDayModal(workdayClient, '2026-08-15');
assert.doesNotMatch(dayModalNodes.layer.innerHTML, /sixth workday task/,
  'Saturday must not show the sixth workday task in the day modal');
dayModalSandbox.openDayModal(workdayClient, '2026-08-17');
assert.match(dayModalNodes.layer.innerHTML, /sixth workday task/,
  'the following Monday must show the sixth workday task in the day modal');
dayModalSandbox.openDayModal(workdayClient, '2026-08-17', {
  getBoundingClientRect: () => ({ left: 20, top: 40, width: 30, height: 20 })
});
assert.strictEqual(dayModalNodes.layer.style['--motion-origin-x'], '35px');
assert.strictEqual(dayModalNodes.layer.style['--motion-origin-y'], '50px');

// Break caught: dates with no recorded management cycle must stay visually neutral.
assert.strictEqual(
  calendarSandbox.calendarDateState(workdayClient, '2026-08-09').isOutsideCycle,
  false,
  'a date before the active cycle without archived management history must not be muted'
);
assert.strictEqual(
  calendarSandbox.calendarDateState(workdayClient, '2026-09-12').isOutsideCycle,
  false,
  'a future date with no recorded management cycle must not be muted as managed history'
);
assert.strictEqual(
  calendarSandbox.calendarDateState(workdayClient, '2026-09-14').isOutsideCycle,
  false,
  'dates after the active cycle without archived management history must stay visually neutral'
);

// Break caught: archived workday cycles must include their intervening weekends visually.
assert.strictEqual(
  calendarSandbox.calendarDateState({
    startDate: '2026-09-14',
    excludeWeekends: true,
    previousCycles: [{ startDate: '2026-08-10', excludeWeekends: true }]
  }, '2026-08-15').isEndedCycle,
  true,
  'a weekend within an archived workday cycle must be marked as ended'
);

const renewalSandbox = {};
vm.runInNewContext([
  functionSource('buildRenewalClient'),
  functionSource('checklistTasksFromSet'),
  functionSource('uid')
].join('\n'), renewalSandbox);
const renewed = renewalSandbox.buildRenewalClient({
  id: 'client-1',
  contractType: 'new',
  startDate: '2026-08-10',
  excludeWeekends: true,
  checklist: []
}, '2026-09-14', null);
assert.strictEqual(renewed.previousCycles[0].excludeWeekends, true,
  'renewal snapshots must retain whether their cycle excluded weekends');

// Break caught: the user-accessible sample-client path must save the same default as the new-client form.
const storedSamples = [];
function FixedDate() {
  return new Date('2026-08-10T12:00:00Z');
}
FixedDate.now = () => 0;
const sampleSandbox = {
  state: { clients: [] },
  Date: FixedDate,
  uid: (prefix) => prefix + '-id',
  monthKey: () => '2026-08',
  setS: async (_key, value) => { storedSamples.push(json(value)); return true; },
  setP: async () => true,
  showToast() {},
  render() {}
};
vm.runInNewContext([
  functionSource('blankClient'),
  functionSource('createSampleClient')
].join('\n'), sampleSandbox);
(async () => {
  await sampleSandbox.createSampleClient();
  assert.strictEqual(storedSamples[0].excludeWeekends, true,
    'sample clients must default to excluding weekends');
  console.log('calendar workday final fixes: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
