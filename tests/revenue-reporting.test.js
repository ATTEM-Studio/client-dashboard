const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
assert.match(html, /coreMetricDefaults/, 'reports should provide core metric defaults');
assert.match(html, /type="hidden" class="m-unit"/, 'report metrics should not require units');
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
  json(sandbox.revenueSummary([
    { clientId:'c1', type:'weekly', period:'2026\uB144 8\uC6D4 1\uC8FC\uCC28', updatedAt:1, revenue:{weekly:1000000} },
    { clientId:'c1', type:'weekly', period:'2026\uB144 8\uC6D4 4\uC8FC\uCC28', updatedAt:2, revenue:{weekly:400000} },
    { clientId:'c1', type:'weekly', period:'2026\uB144 8\uC6D4 5\uC8FC\uCC28', updatedAt:3, revenue:{weekly:500000} }
  ], 'c1', '2026-08')),
  { weeklyByWeek:[1000000,null,null,900000], weeklyTotal:1900000,
    monthlyOverride:null, previousMonth:null, displayTotal:1900000, hasRevenue:true },
  'the finishing fifth weekly report must be included in the fourth chart slot and monthly total'
);

assert.deepStrictEqual(
  json(sandbox.revenueAxis(2180000)),
  { max:3000000, step:1000000, labels:[0,1000000,2000000,3000000] }
);
assert.deepStrictEqual(
  json(sandbox.revenueAxis(0)),
  { max:0, step:1000000, labels:[0] }
);

assert.match(html, /id="f-revenue-weekly"/, 'weekly reports must expose the optional revenue input');
assert.match(html, /id="f-delivery-memo"/, 'weekly reports must expose a delivery memo field');
assert.match(html, /rep\.deliveryMemo/,
  'weekly report views must render a saved delivery memo when present');
assert.match(html, /id="f-revenue-previous"/, 'monthly reports must expose the optional previous-month input');
assert.match(html, /id="f-revenue-override"/, 'monthly reports must expose the optional confirmed override input');

const renderMatch = html.match(/(function formatRevenueWon[\s\S]*?\n  function reportRevenueSection[\s\S]*?\n  })/);
assert.ok(renderMatch, 'revenue formatting and render helpers must exist in index.html');
Object.assign(sandbox, {
  esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[character]);
  },
  currentWeekOf() { return 2; }
});
vm.runInNewContext(renderMatch[1], sandbox);

assert.strictEqual(sandbox.formatRevenueWon(2180000), '218\uB9CC \uC6D0');
assert.strictEqual(sandbox.formatRevenueWon(0), '0\uC6D0', 'stored zero must remain displayable');
assert.strictEqual(sandbox.revenueTrendPanel('c1', [], '2026-08'), '',
  'a client with no usable revenue must not get an empty chart shell');
assert.strictEqual(sandbox.reportRevenueSection({ type:'weekly' }, []), '',
  'a legacy weekly report must not get an empty revenue section');

const trendReports = [
  { id:'w1', clientId:'c1', type:'weekly', period:'2026\uB144 8\uC6D4 1\uC8FC\uCC28', updatedAt:1, revenue:{weekly:1000000} },
  { id:'w2', clientId:'c1', type:'weekly', period:'2026\uB144 8\uC6D4 2\uC8FC\uCC28', updatedAt:2, revenue:{weekly:2180000} }
];
const trend = sandbox.revenueTrendPanel('c1', trendReports, '2026-08');
const trendAxis = trend.match(/<div class="revenue-y-axis">([\s\S]*?)<\/div>/);
assert.ok(trendAxis, 'the chart must render a visible y axis');
assert.match(trendAxis[1], /100\uB9CC/, 'the chart axis must use Korean ten-thousand-unit labels');
assert.match(trendAxis[1], /200\uB9CC/, 'the chart axis must retain the next Korean scale step');
assert.match(trend, /218\uB9CC \uC6D0/, 'entered bars must show exact Korean amounts');
assert.match(trend, /revenue-bar-stack[^>]*><span class="revenue-bar-value">218\uB9CC \uC6D0<\/span>/,
  'each exact amount label must be positioned by the same stack as its bar');
assert.doesNotMatch(html, /\.revenue-bar-value\{[^}]*\btop:/,
  'exact amount labels must not be pinned to the chart ceiling');
assert.strictEqual((trend.match(/revenue-bar-slot/g) || []).length, 4, 'the trend must always use four weekly slots');
assert.match(trend, /aria-label=/, 'the bar chart must have an accessible text label');
assert.doesNotMatch(trend, /onclick|<svg|<path|trend-line/i,
  'the approved trend is bar-only and must not use click-to-reveal behavior');

const trendWithBlankCurrentWeek = sandbox.revenueTrendPanel('c1', [
  trendReports[0],
  { id:'w2-blank', clientId:'c1', type:'weekly', period:'2026\uB144 8\uC6D4 2\uC8FC\uCC28', updatedAt:3 }
], '2026-08');
assert.match(trendWithBlankCurrentWeek, /data-edit-revenue="w2-blank"/,
  'the revenue action must prefer the existing current-week editor even before revenue is entered');

const zeroSection = sandbox.reportRevenueSection({
  id:'w0', clientId:'c1', type:'weekly', period:'2026\uB144 8\uC6D4 1\uC8FC\uCC28', revenue:{weekly:0}
}, []);
assert.match(zeroSection, /0\uC6D0/, 'zero is a real entered value, not an absent value');

const monthlySection = sandbox.reportRevenueSection({
  id:'m1', clientId:'c1', type:'monthly', period:'2026\uB144 8\uC6D4', updatedAt:3,
  revenue:{previousMonth:2500000, monthlyOverride:3300000}
}, trendReports);
assert.match(monthlySection, /330\uB9CC \uC6D0/, 'the confirmed monthly override must be displayed');
assert.match(monthlySection, /318\uB9CC \uC6D0/, 'the automatic weekly sum must remain visible beside an override');
assert.match(monthlySection, /250\uB9CC \uC6D0/, 'the optional previous-month comparison must be displayed');

const historicalMonthlySection = sandbox.reportRevenueSection({
  id:'m-old', clientId:'c1', type:'monthly', period:'2026\uB144 8\uC6D4', updatedAt:3,
  revenue:{previousMonth:2500000, monthlyOverride:3300000}
}, trendReports.concat({
  id:'m-new', clientId:'c1', type:'monthly', period:'2026\uB144 8\uC6D4', updatedAt:9,
  revenue:{previousMonth:4800000, monthlyOverride:5000000}
}));
assert.match(historicalMonthlySection, /330\uB9CC \uC6D0/,
  'a historical monthly report view must show its own embedded confirmed amount');
assert.doesNotMatch(historicalMonthlySection, /500\uB9CC \uC6D0/,
  'a newer monthly report must not rewrite an older report view');

const sharedMonthlySection = sandbox.reportRevenueSection({
  id:'shared-m1', clientId:'c1', type:'monthly', period:'2026\uB144 8\uC6D4',
  revenue:{weeklyTotal:3180000}
}, []);
assert.match(sharedMonthlySection, /318\uB9CC \uC6D0/,
  'a shared monthly report must render its embedded automatic weekly-total snapshot without loading other reports');

const saveMatch = html.match(/(async function saveReport\(\)\{[\s\S]*?\r?\n  })\r?\n\r?\n  async function openReport/);
assert.ok(saveMatch, 'saveReport must exist in index.html');

function saveSandbox(revenueValue, options = {}) {
  const type = options.type || 'weekly';
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
    'f-period': { value: type === 'weekly' ? '2026\uB144 8\uC6D4 1\uC8FC\uCC28' : '2026\uB144 8\uC6D4' },
    'btn-save': { disabled: false, textContent: '' },
    'f-goal': { value: '' },
    'f-external': { value: '' },
    'f-uncertain': { value: '' },
    'f-delivery-memo': { value: options.deliveryMemo || '' },
    'f-memo': { value: '' }
  };
  if(options.includeRevenueInput !== false){
    if(type === 'weekly') elements['f-revenue-weekly'] = revenueInput;
    else {
      elements['f-revenue-previous'] = Object.assign({}, revenueInput, { value: options.previousValue ?? revenueValue });
      elements['f-revenue-override'] = Object.assign({}, revenueInput, { value: options.overrideValue ?? revenueValue });
    }
  }
  const context = {
    parseRevenueWon: sandbox.parseRevenueWon,
    reportMonthKey: sandbox.reportMonthKey,
    revenueSummary: sandbox.revenueSummary,
    document: {
      getElementById(id) { return elements[id] || null; },
      querySelector(selector) {
        assert.strictEqual(selector, '.form-card');
        return { getAttribute() { return type; } };
      }
    },
    state: {
      editingBase: options.editingBase || {}, currentClient: { id: 'c1' }, reports: options.reports || [],
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

  const weeklyMemo = saveSandbox('', { deliveryMemo: '이번 주는 리뷰 답글 확인 부탁드립니다.' });
  await weeklyMemo.context.saveReport();
  assert.strictEqual(weeklyMemo.stored[0].value.deliveryMemo, '이번 주는 리뷰 답글 확인 부탁드립니다.',
    'weekly reports must persist an optional delivery memo');

  const monthlyWithWeeklySnapshot = saveSandbox('', {
    type: 'monthly', reports: trendReports, previousValue: '', overrideValue: ''
  });
  await monthlyWithWeeklySnapshot.context.saveReport();
  assert.deepStrictEqual(json(monthlyWithWeeklySnapshot.stored[0].value.revenue), { weeklyTotal: 3180000 },
    'saving a monthly report must embed its current automatic weekly total for safe share-link rendering');

  const monthlySnapshotWithoutLiveWeeks = saveSandbox('', {
    type: 'monthly', previousValue: '', overrideValue: '',
    editingBase: { id:'monthly-snapshot', createdAt:1, clientId:'c1', revenue:{weeklyTotal:3180000} }
  });
  await monthlySnapshotWithoutLiveWeeks.context.saveReport();
  assert.deepStrictEqual(json(monthlySnapshotWithoutLiveWeeks.stored[0].value.revenue), { weeklyTotal:3180000 },
    'editing without live weekly reports must preserve an existing monthly snapshot for shared links');

  const weeklyEditWithoutInput = saveSandbox(undefined, {
    includeRevenueInput: false,
    editingBase: { id: 'weekly-existing', createdAt: 1, clientId: 'c1', revenue: { weekly: 0 } }
  });
  await weeklyEditWithoutInput.context.saveReport();
  assert.ok(weeklyEditWithoutInput.stored[0].value.revenue,
    'editing without a rendered revenue field must keep embedded revenue');
  assert.deepStrictEqual(json(weeklyEditWithoutInput.stored[0].value.revenue), { weekly: 0 },
    'editing without a rendered revenue field must preserve a stored weekly zero');

  const monthlyEditWithoutInputs = saveSandbox(undefined, {
    type: 'monthly',
    includeRevenueInput: false,
    editingBase: {
      id: 'monthly-existing', createdAt: 1, clientId: 'c1',
      revenue: { previousMonth: 0, monthlyOverride: 3100000 }
    }
  });
  await monthlyEditWithoutInputs.context.saveReport();
  assert.ok(monthlyEditWithoutInputs.stored[0].value.revenue,
    'editing without rendered monthly revenue fields must keep embedded revenue');
  assert.deepStrictEqual(
    json(monthlyEditWithoutInputs.stored[0].value.revenue),
    { previousMonth: 0, monthlyOverride: 3100000 },
    'editing without rendered monthly revenue fields must preserve every stored value'
  );

  const visibleBlankEdit = saveSandbox('   ', {
    editingBase: { id: 'weekly-cleared', createdAt: 1, clientId: 'c1', revenue: { weekly: 900000 } }
  });
  await visibleBlankEdit.context.saveReport();
  assert.strictEqual(Object.prototype.hasOwnProperty.call(visibleBlankEdit.stored[0].value, 'revenue'), false,
    'clearing a visible revenue field must intentionally remove stored revenue');

  console.log('revenue reporting helpers and persistence: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
