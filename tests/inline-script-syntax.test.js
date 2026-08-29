const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
new Function(script);

assert.match(html, /id="renewal-modal"/);
assert.match(html, /id="renewal-start-date"/);
assert.match(html, /data-renewal-set=/);
assert.match(html, /id="f-exclude-weekends"/);
assert.match(html, /\uC8FC\uB9D0 ?\uC81C\uC678/);
assert.match(html, /세트 없이 시작/);
assert.match(html, /재계약 시작일은 월요일만 선택할 수 있습니다\./);
assert.match(html, /재계약 저장에 실패했습니다/);

assert.match(html, /id="btn-toggle-sets"[^>]*aria-expanded=/, 'checklist view must expose the compact set toggle');
assert.doesNotMatch(html, /return '<div class="workspace-columns"/, 'ordinary checklist view must not render the old two-column set panel');
assert.match(html, /data-set-period="1"/, 'set editor must navigate to week 1');
assert.match(html, /data-set-period="4"/, 'set editor must navigate to week 4');
assert.match(html, /data-set-period="closing"/, 'set editor must navigate to the closing period');
assert.match(html, /checklistSetPeriodDays\(period,excludeWeekends\)/, 'set editor must derive visible days from the weekend-aware period helper');
assert.match(html, /\[21,22\]/, 'weekend-aware closing editor must map to workdays 21 and 22');
assert.match(html, /data-add-set-task/, 'each day must support adding task rows');
assert.match(html, /data-remove-set-task/, 'daily task rows must be independently removable');
assert.match(html, /data-move-set-task/, 'daily task rows must expose reorder controls');

const dayCardMatch = html.match(/(function checklistSetDayCard[\s\S]*?\n  \})(?=\n  function checklistSetLegacyRows)/);
assert.ok(dayCardMatch, 'the daily task card renderer must exist');
const dayCardSandbox = { esc(value){ return String(value); } };
vm.runInNewContext(dayCardMatch[1], dayCardSandbox);
const dayCard = dayCardSandbox.checklistSetDayCard({ items: [
  { day: 1, text: 'first task' },
  { day: 2, text: 'other day task' },
  { day: 1, text: 'second task' }
] }, 1, 'data-set-day="1"');
assert.strictEqual((dayCard.match(/data-move-set-task=/g) || []).length, 4, 'each task row must have move-up and move-down controls');
assert.match(dayCard, /aria-label="1일차 1번째 업무 위로 이동" disabled/, 'the first daily task cannot move above its day boundary');
assert.match(dayCard, /aria-label="1일차 1번째 업무 아래로 이동"/, 'the first daily task can move down');
assert.match(dayCard, /aria-label="1일차 2번째 업무 위로 이동"/, 'the second daily task can move up');
assert.match(dayCard, /aria-label="1일차 2번째 업무 아래로 이동" disabled/, 'the final daily task cannot move below its day boundary');

const collectionNavigation = html.match(/(function setChecklistCollectionOpen[\s\S]*?\n  })(?=\n  var _clientTabMotionPending)/);
const tabNavigation = html.match(/(function setClientWorkspaceTab[\s\S]*?\n  })(?=\n  function renderClientWorkspace)/);
assert.ok(collectionNavigation && tabNavigation, 'checklist set draft navigation helpers must exist');

const draft = { name: 'before typing', items: [{ day: 1, text: 'before typing' }] };
let syncCalls = 0;
const sandbox = {
  state: { setCollectionOpen: true, checklistSetDraft: draft, clientTab: 'checklist' },
  syncChecklistSetEditor(){
    syncCalls += 1;
    draft.name = 'typed set name';
    draft.items[0].text = 'typed task';
  }
};
vm.runInNewContext([collectionNavigation[1], tabNavigation[1]].join('\n'), sandbox);

sandbox.setChecklistCollectionOpen(false);
assert.strictEqual(sandbox.state.setCollectionOpen, false, 'visibility toggle must collapse the collection');
assert.strictEqual(sandbox.state.checklistSetDraft, draft, 'collapsing the collection must preserve its unsaved draft');
assert.strictEqual(syncCalls, 1, 'collapsing the editor must synchronize its visible fields before rerendering');
assert.strictEqual(draft.name, 'typed set name');
assert.strictEqual(draft.items[0].text, 'typed task');
sandbox.setChecklistCollectionOpen(true);
assert.strictEqual(sandbox.state.checklistSetDraft, draft, 'reopening the collection must restore the same draft');

sandbox.setClientWorkspaceTab('reports');
assert.strictEqual(syncCalls, 2, 'tab navigation must synchronize visible editor fields before rerendering');
assert.strictEqual(sandbox.state.clientTab, 'reports');
assert.strictEqual(draft.name, 'typed set name');
assert.strictEqual(draft.items[0].text, 'typed task');

const renderEntry = html.match(/(function render\(\)\{[\s\S]*?\n  \})/);
assert.ok(renderEntry, 'the global render entry point must exist');
let globalRenderSawSyncedDraft = false;
const globalRenderSandbox = {
  state: { view: 'dashboard' },
  syncChecklistSetEditor(){
    globalRenderSawSyncedDraft = true;
  },
  renderDashboard(){
    assert.strictEqual(globalRenderSawSyncedDraft, true, 'Back and Edit navigation must synchronize the draft before rendering another view');
  }
};
vm.runInNewContext(renderEntry[1], globalRenderSandbox);
globalRenderSandbox.render();

const workspaceRenderEntry = html.match(/(function renderClientWorkspace[\s\S]*?\n  \})(?=\n  function calendarPanel)/);
assert.ok(workspaceRenderEntry, 'the client-workspace render entry point must exist');
let workspaceRenderSawSyncedDraft = false;
const workspaceApp = {
  set innerHTML(value){
    assert.strictEqual(workspaceRenderSawSyncedDraft, true, 'client task and Renew rerenders must synchronize the draft before replacing editor fields');
    this.value = value;
  },
  querySelectorAll(){ return []; }
};
const workspaceRenderSandbox = {
  state: { clientTab: 'calendar', reports: [], setCollectionOpen: true },
  _clientTabMotionPending: false,
  _calendarMotionDirection: '',
  syncChecklistSetEditor(){
    workspaceRenderSawSyncedDraft = true;
  },
  calendarPanel(){ return '<div>calendar</div>'; },
  checklistPanel(){ throw new Error('unexpected checklist render'); },
  reportRows(){ return ''; },
  esc(value){ return String(value); },
  app: workspaceApp,
  document: { getElementById(){ return {}; } },
  bindCalendarPanel(){},
  bindChecklistPanel(){},
  bindReportPanel(){},
  bindPressFeedback(){}
};
vm.runInNewContext(workspaceRenderEntry[1], workspaceRenderSandbox);
workspaceRenderSandbox.renderClientWorkspace({
  id: 'client-1', name: 'Client', industry: '', startDate: '2026-03-07',
  contractType: 'new', checklist: []
});

let trendArgs = null;
workspaceRenderSawSyncedDraft = false;
workspaceRenderSandbox.state.clientTab = 'reports';
workspaceRenderSandbox.state.month = '2026-08';
workspaceRenderSandbox.revenueTrendPanel = function(clientId, reports, month){
  trendArgs = { clientId, reports, month };
  return '<div data-test-revenue-trend>revenue trend</div>';
};
workspaceRenderSandbox.renderClientWorkspace({
  id: 'client-1', name: 'Client', industry: '', startDate: '2026-03-07',
  contractType: 'new', checklist: []
});
assert.deepStrictEqual(trendArgs, {
  clientId: 'client-1', reports: workspaceRenderSandbox.state.reports, month: '2026-08'
}, 'the reports tab must derive its trend from the existing report collection and selected month');
assert.match(workspaceApp.value, /data-test-revenue-trend/,
  'the reports tab must render the revenue trend below its report rows');
console.log('inline script syntax: ok');
