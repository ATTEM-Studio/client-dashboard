const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/(function parseRevenueWon[\s\S]*?\n  function revenueAxis[\s\S]*?\n  })/);
assert.ok(match, 'revenue derivation helpers must exist in index.html');

const sandbox = {};
vm.runInNewContext(match[1], sandbox);
const json = (value) => JSON.parse(JSON.stringify(value));

assert.strictEqual(sandbox.parseRevenueWon(' 1,250,000 '), 1250000);
assert.strictEqual(sandbox.parseRevenueWon('0'), 0, 'stored zero is valid revenue');
assert.strictEqual(sandbox.parseRevenueWon(''), null);
assert.strictEqual(sandbox.parseRevenueWon('-1'), null);
assert.strictEqual(sandbox.parseRevenueWon('12.5'), null);
assert.strictEqual(sandbox.parseRevenueWon('9007199254740992'), null, 'unsafe integers are invalid');

assert.strictEqual(sandbox.reportMonthKey('2026\uB144 8\uC6D4'), '2026-08');
assert.strictEqual(sandbox.reportMonthKey('2026\uB144 8\uC6D4 2\uC8FC\uCC28'), '2026-08');
assert.strictEqual(sandbox.reportMonthKey('2026\uB144 13\uC6D4'), null);
assert.strictEqual(sandbox.reportMonthKey(''), null);

assert.deepStrictEqual(
  json(sandbox.revenueSummary([
    { clientId:'c1', type:'weekly', period:'2026\uB144 8\uC6D4 1\uC8FC\uCC28', updatedAt:1, revenue:{weekly:1200000} },
    { clientId:'c1', type:'weekly', period:'2026\uB144 8\uC6D4 2\uC8FC\uCC28', updatedAt:2, revenue:{weekly:1800000} },
    { clientId:'c1', type:'monthly', period:'2026\uB144 8\uC6D4', updatedAt:3, revenue:{previousMonth:2500000, monthlyOverride:3100000} },
    { clientId:'c2', type:'weekly', period:'2026\uB144 8\uC6D4 3\uC8FC\uCC28', updatedAt:4, revenue:{weekly:9900000} },
    { clientId:'c1', type:'weekly', period:'2026\uB144 7\uC6D4 3\uC8FC\uCC28', updatedAt:5, revenue:{weekly:8800000} }
  ], 'c1', '2026-08')),
  { weeklyByWeek:[1200000,1800000,null,null], weeklyTotal:3000000,
    monthlyOverride:3100000, previousMonth:2500000, displayTotal:3100000, hasRevenue:true }
);

assert.deepStrictEqual(
  json(sandbox.revenueSummary([
    { clientId:'c1', type:'monthly', period:'2026\uB144 8\uC6D4', updatedAt:10, revenue:{monthlyOverride:4000000, previousMonth:3500000} },
    { clientId:'c1', type:'monthly', period:'2026\uB144 8\uC6D4', updatedAt:20, revenue:{monthlyOverride:4200000, previousMonth:3600000} }
  ], 'c1', '2026-08')),
  { weeklyByWeek:[null,null,null,null], weeklyTotal:null,
    monthlyOverride:4200000, previousMonth:3600000, displayTotal:4200000, hasRevenue:true },
  'the latest same-month monthly report wins'
);

assert.strictEqual(sandbox.revenueSummary([], 'c1', '2026-08').hasRevenue, false);
assert.deepStrictEqual(
  json(sandbox.revenueSummary([], 'c1', '2026-08')),
  { weeklyByWeek:[null,null,null,null], weeklyTotal:null,
    monthlyOverride:null, previousMonth:null, displayTotal:null, hasRevenue:false },
  'missing stored revenue must stay null rather than becoming zero'
);

assert.deepStrictEqual(
  json(sandbox.revenueAxis(2180000)),
  { max:3000000, step:1000000, labels:[0,1000000,2000000,3000000] }
);
assert.deepStrictEqual(
  json(sandbox.revenueAxis(0)),
  { max:0, step:1000000, labels:[0] }
);

const saveMatch = html.match(/(async function saveReport\(\)\{[\s\S]*?\r?\n  })\r?\n\r?\n  async function openReport/);
assert.ok(saveMatch, 'saveReport must exist in index.html');

function saveSandbox(revenueValue) {
  const stored = [];
  const revenueInput = {
    value: revenueValue,
    validationMessage: '',
    validityShown: false,
    focused: false,
    setCustomValidity(message) { this.validationMessage = message; },
    reportValidity() { this.validityShown = true; },
    focus() { this.focused = true; }
  };
  const elements = {
    'f-client': { value: 'Client One' },
    'f-period': { value: '2026\uB144 8\uC6D4 1\uC8FC\uCC28' },
    'f-revenue-weekly': revenueInput,
    'btn-save': { disabled: false, textContent: '' },
    'f-goal': { value: '' },
    'f-external': { value: '' }
  };
  const context = {
    parseRevenueWon: sandbox.parseRevenueWon,
    document: {
      getElementById(id) { return elements[id] || null; },
      querySelector(selector) {
        assert.strictEqual(selector, '.form-card');
        return { getAttribute() { return 'weekly'; } };
      }
    },
    state: {
      editingBase: {}, currentClient: { id: 'c1' }, reports: [],
      currentReport: null, summaryMode: false, view: 'edit'
    },
    collectChannels() { return []; },
    collectRows() { return []; },
    uid() { return 'rpt-1'; },
    async setS(key, value) { stored.push({ key, value }); return true; },
    async setP() { return true; },
    showToast() {},
    render() {},
    console
  };
  vm.runInNewContext(saveMatch[1], context);
  return { context, elements, revenueInput, stored };
}

(async () => {
  const invalid = saveSandbox('-1');
  await invalid.context.saveReport();
  assert.strictEqual(invalid.stored.length, 0, 'invalid nonblank revenue must stop before storage');
  assert.ok(invalid.revenueInput.validationMessage, 'invalid revenue must expose an inline validation message');
  assert.strictEqual(invalid.revenueInput.validityShown, true);
  assert.strictEqual(invalid.revenueInput.focused, true);
  assert.strictEqual(invalid.elements['btn-save'].disabled, false, 'validation must happen before disabling save');

  const blank = saveSandbox('   ');
  await blank.context.saveReport();
  assert.strictEqual(blank.stored.length, 1);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(blank.stored[0].value, 'revenue'), false,
    'an all-blank revenue form must preserve the legacy report shape');

  const populated = saveSandbox(' 1,250,000 ');
  await populated.context.saveReport();
  assert.deepStrictEqual(json(populated.stored[0].value.revenue), { weekly: 1250000 });

  console.log('revenue reporting helpers and persistence: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
