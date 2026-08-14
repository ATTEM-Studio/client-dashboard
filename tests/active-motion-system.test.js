const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

assert.match(source, /--motion-press:\s*110ms/);
assert.match(source, /--motion-short:\s*200ms/);
assert.match(source, /--motion-spatial:\s*460ms/);
assert.match(source, /--ease-spring:/);
assert.match(source, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
assert.match(source, /function restartMotion\(element,className\)/);
assert.match(source, /function setAsyncVisualState\(element,state\)/);
assert.match(source, /function bindPressFeedback\(root\)/);
assert.match(source, /pointerdown/);
assert.match(source, /pointerup/);
assert.match(source, /--motion-origin-x/);
assert.match(source, /\.dashboard-menu-panel[^}]*transform-origin/);
assert.match(source, /\.modal-layer\.show \.modal/);
assert.match(source, /\.tab-content-enter/);
assert.match(source, /aria-expanded/);
assert.match(source, /#renewal-modal\.show \.modal\{[^}]*opacity:1/);
assert.match(source, /layer\.className="modal-layer show"/);
assert.match(source, /\.client-card:hover\.is-pressing\{[^}]*transform:scale\(\.97\)/);
assert.match(source, /async function saveClientWithFeedback\(client,element\)/);
assert.match(source, /setAsyncVisualState\(element,'saving'\)/);
assert.match(source, /setAsyncVisualState\(element,'saved'\)/);
assert.match(source, /setAsyncVisualState\(element,'error'\)/);
assert.match(source, /function persistClientSnapshot\(snapshot(?:,baseline)?\)/);
assert.match(source, /calendar-enter-left/);
assert.match(source, /calendar-enter-right/);
assert.match(source, /check-section-body[^}]*overflow:hidden/);
assert.match(source, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*?\.calendar-enter-left,\.calendar-enter-right\{animation:none!important;transform:none!important\}/);
assert.match(source, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*?\.check-section-body\{transition:none!important\}/);

const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
const helper = script.match(/function restartMotion\(element,className\)[\s\S]*?\n\s*}/)[0];
const motionHelper = script.match(/function motionReduced\(\)[\s\S]*?\n\s*}/)[0];
const classes = new Set();
const element = {
  classList: { remove: c => classes.delete(c), add: c => classes.add(c) },
  offsetWidth: 10
};
vm.runInNewContext(`${motionHelper}; ${helper}; restartMotion(element, 'motion-enter')`, {
  element,
  window: { matchMedia: () => ({ matches: false }) }
});
assert.equal(classes.has('motion-enter'), true);

function functionSource(name) {
  const match = source.match(new RegExp(
    '(^  (?:async )?function ' + name + '\\([\\s\\S]*?)(?=\\r?\\n  (?:async )?function |\\r?\\n  /\\*)',
    'm'
  ));
  assert.ok(match, name + ' must exist');
  return match[1];
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

const reducedClasses = new Set();
vm.runInNewContext([
  functionSource('motionReduced'),
  functionSource('restartMotion'),
  "restartMotion(element, 'calendar-enter-left');"
].join('\n'), {
  window: { matchMedia: () => ({ matches: true }) },
  element: { classList: { remove: (name) => reducedClasses.delete(name), add: (name) => reducedClasses.add(name) }, offsetWidth: 1 }
});
assert.strictEqual(reducedClasses.has('calendar-enter-left'), false,
  'reduced motion must not start a translated calendar entrance');

async function verifyClientSaveOrderingAndRollback() {
  const queuedWrites = [];
  const indexWrites = [];
  let releaseFirstWrite;
  let stored = { id: 'client-1', name: 'Client', checklist: [{ id: 'task-1', done: false }] };
  const sandbox = {
    state: { clients: [{ id: 'client-1', name: 'Client', updatedAt: 1 }], view: 'clientDetail' },
    Date: { now: () => 100 },
    readS: async () => ({ status: 'found', value: copy(stored) }),
    setS: async (key, value) => {
      queuedWrites.push(copy(value));
      if (queuedWrites.length === 1) await new Promise((resolve) => { releaseFirstWrite = resolve; });
      stored = copy(value);
      return true;
    },
    setP: async (key, value) => { indexWrites.push(copy(value)); return true; },
    delS: async () => true,
    render: () => { throw new Error('single-toggle saves must not rerender the workspace'); }
  };
  vm.runInNewContext([
    'var _clientSaveQueue=Promise.resolve(), _clientSaveVersions={}, _clientSaveBaselines={}, _clientSaveNoteReconciliations={};',
    functionSource('copyClientForSave'),
    functionSource('clientIndexEntry'),
    functionSource('persistClientSnapshot'),
    functionSource('saveClientAndRefresh')
  ].join('\n'), sandbox);

  const client = { id: 'client-1', name: 'Client', checklist: [{ id: 'task-1', done: true }] };
  const first = sandbox.saveClientAndRefresh(client, { refresh: false });
  await new Promise((resolve) => setImmediate(resolve));
  client.checklist[0].done = false;
  const second = sandbox.saveClientAndRefresh(client, { refresh: false });
  assert.deepStrictEqual(queuedWrites.map((value) => value.checklist[0].done), [true],
    'the next client snapshot must wait for the prior write to settle');
  releaseFirstWrite();
  const outcomes = await Promise.all([first, second]);
  assert.deepStrictEqual(queuedWrites.map((value) => value.checklist[0].done), [true, false],
    'writes must preserve the user\'s latest toggle intent in order');
  assert.strictEqual(outcomes[0].isLatest, false);
  assert.strictEqual(outcomes[1].isLatest, true);
  assert.strictEqual(stored.checklist[0].done, false);
  assert.strictEqual(indexWrites[indexWrites.length - 1][0].updatedAt, 100);

  const rollbackWrites = [];
  const original = { id: 'client-2', name: 'Rollback Client', checklist: [{ id: 'task-2', done: false }] };
  const rollbackSandbox = {
    state: { clients: [{ id: 'client-2', name: 'Rollback Client', updatedAt: 1 }], view: 'clientDetail' },
    Date: { now: () => 200 },
    readS: async () => ({ status: 'found', value: copy(original) }),
    setS: async (key, value) => { rollbackWrites.push(copy(value)); return true; },
    setP: async () => false,
    delS: async () => true,
    render: () => { throw new Error('failed saves must not rerender the workspace'); }
  };
  vm.runInNewContext([
    'var _clientSaveQueue=Promise.resolve(), _clientSaveVersions={}, _clientSaveBaselines={}, _clientSaveNoteReconciliations={};',
    functionSource('copyClientForSave'),
    functionSource('clientIndexEntry'),
    functionSource('persistClientSnapshot'),
    functionSource('saveClientAndRefresh')
  ].join('\n'), rollbackSandbox);
  const changed = { id: 'client-2', name: 'Rollback Client', checklist: [{ id: 'task-2', done: true }] };
  await assert.rejects(() => rollbackSandbox.saveClientAndRefresh(changed, { refresh: false }), /client index save failed/);
  assert.deepStrictEqual(rollbackWrites.map((value) => value.checklist[0].done), [true, false],
    'an index failure must compensate the persisted client before reporting failure');
  assert.deepStrictEqual(rollbackSandbox.state.clients, [{ id: 'client-2', name: 'Rollback Client', updatedAt: 1 }]);
}

verifyClientSaveOrderingAndRollback().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function verifyClientSaveFailureReconciliation() {
  const feedbackStates = [];
  const feedbackSandbox = {
    _saveFeedbackTokens: new WeakMap(),
    setAsyncVisualState: (element, state) => feedbackStates.push(state),
    saveClientAndRefresh: async () => ({ isLatest: false }),
    showToast: () => { throw new Error('stale feedback must not show an error toast'); }
  };
  vm.runInNewContext(functionSource('saveClientWithFeedback'), feedbackSandbox);
  await feedbackSandbox.saveClientWithFeedback({}, {});
  assert.deepStrictEqual(feedbackStates, ['saving', 'idle'],
    'a stale save completion must clear its own saving feedback');
  feedbackStates.length = 0;
  feedbackSandbox.saveClientAndRefresh = async () => {
    const error = new Error('stale failure');
    error.clientSaveIsLatest = false;
    throw error;
  };
  await assert.rejects(() => feedbackSandbox.saveClientWithFeedback({}, {}), /stale failure/);
  assert.deepStrictEqual(feedbackStates, ['saving', 'idle'],
    'a stale failed save must also clear its own saving feedback');

  const stored = { id: 'client-3', name: 'Failure Client', checklist: [{ id: 'task-3', done: false }] };
  const twoFailureSandbox = {
    state: { clients: [{ id: 'client-3', name: 'Failure Client', updatedAt: 1 }], view: 'clientDetail' },
    Date: { now: () => 300 },
    readS: async () => ({ status: 'found', value: copy(stored) }),
    setS: async () => true,
    setP: async () => false,
    delS: async () => true,
    render: () => { throw new Error('feedback save failures must not rerender the workspace'); }
  };
  vm.runInNewContext([
    'var _clientSaveQueue=Promise.resolve(), _clientSaveVersions={}, _clientSaveBaselines={}, _clientSaveNoteReconciliations={};',
    functionSource('copyClientForSave'),
    functionSource('clientIndexEntry'),
    functionSource('persistClientSnapshot'),
    functionSource('reconcileClientSave'),
    functionSource('saveClientAndRefresh')
  ].join('\n'), twoFailureSandbox);
  const client = { id: 'client-3', name: 'Failure Client', checklist: [{ id: 'task-3', done: true }] };
  const first = twoFailureSandbox.saveClientAndRefresh(client, { refresh: false });
  client.checklist[0].done = false;
  const second = twoFailureSandbox.saveClientAndRefresh(client, { refresh: false });
  const results = await Promise.allSettled([first, second]);
  assert.strictEqual(results[0].reason.clientSaveIsLatest, false);
  assert.strictEqual(results[1].reason.clientSaveIsLatest, true);
  assert.strictEqual(twoFailureSandbox.reconcileClientSave(client, results[1].reason), true);
  assert.strictEqual(client.checklist[0].done, false,
    'the latest failed operation must reconcile optimistic data to its compensated persisted snapshot');

  const readFailureSandbox = {
    state: { clients: [], view: 'clientDetail' },
    Date: { now: () => 301 },
    readS: async () => ({ status: 'error', error: new Error('offline') }),
    setS: async () => { throw new Error('read failure must not mutate client storage'); },
    setP: async () => { throw new Error('read failure must not mutate client index'); },
    delS: async () => { throw new Error('read failure must not delete client storage'); },
    render: () => { throw new Error('read failure reconciliation must not rerender the workspace'); }
  };
  vm.runInNewContext([
    'var _clientSaveQueue=Promise.resolve(), _clientSaveVersions={}, _clientSaveBaselines={}, _clientSaveNoteReconciliations={};',
    functionSource('copyClientForSave'),
    functionSource('clientIndexEntry'),
    functionSource('persistClientSnapshot'),
    functionSource('reconcileClientSave'),
    functionSource('saveClientAndRefresh')
  ].join('\n'), readFailureSandbox);
  const readFailureClient = { id: 'client-read-failure', checklist: [{ id: 'a', done: false }, { id: 'b', done: false }] };
  const confirmedBaseline = copy(readFailureClient);
  readFailureClient.checklist[0].done = true;
  const readFailureFirst = readFailureSandbox.saveClientAndRefresh(readFailureClient, { refresh: false, rollbackSnapshot: confirmedBaseline });
  readFailureClient.checklist[1].done = true;
  const readFailureSecond = readFailureSandbox.saveClientAndRefresh(readFailureClient, { refresh: false, rollbackSnapshot: copy(readFailureClient) });
  const readFailureResults = await Promise.allSettled([readFailureFirst, readFailureSecond]);
  assert.strictEqual(readFailureResults[0].reason.clientSaveIsLatest, false);
  assert.strictEqual(readFailureResults[1].reason.clientSaveIsLatest, true);
  assert.strictEqual(readFailureSandbox.reconcileClientSave(readFailureClient, readFailureResults[1].reason), true);
  assert.deepStrictEqual(Array.from(readFailureClient.checklist, (task) => task.done), [false, false],
    'two queued read failures must retain the confirmed queue baseline for latest-failure reconciliation');

  const readErrorWrites = [];
  const readErrorSandbox = {
    state: { clients: [] },
    readS: async () => ({ status: 'error', error: new Error('offline') }),
    setS: async () => { readErrorWrites.push('set'); return true; },
    setP: async () => true,
    delS: async () => { readErrorWrites.push('delete'); return true; }
  };
  vm.runInNewContext([
    functionSource('clientIndexEntry'),
    functionSource('persistClientSnapshot')
  ].join('\n'), readErrorSandbox);
  await assert.rejects(() => readErrorSandbox.persistClientSnapshot({ id: 'client-4' }), /prior state unavailable/);
  assert.deepStrictEqual(readErrorWrites, [],
    'an unconfirmed prior state must block writes and destructive compensation');

  const missingWrites = [];
  const missingSandbox = {
    state: { clients: [] },
    readS: async () => ({ status: 'missing' }),
    setS: async (key, value) => { missingWrites.push(['set', copy(value)]); return true; },
    setP: async () => false,
    delS: async () => { missingWrites.push(['delete']); return true; }
  };
  vm.runInNewContext([
    functionSource('clientIndexEntry'),
    functionSource('persistClientSnapshot')
  ].join('\n'), missingSandbox);
  await assert.rejects(() => missingSandbox.persistClientSnapshot({ id: 'client-5' }), /client index save failed/);
  assert.deepStrictEqual(missingWrites, [['set', { id: 'client-5' }], ['delete']],
    'only a confirmed missing prior state may use deletion as compensation');
}

verifyClientSaveFailureReconciliation().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function makeTaskControl(id) {
  return {
    id,
    checked: false,
    getAttribute: (name) => name === 'data-toggle-work' ? id : null,
    classList: { toggle: () => {} },
    closest: () => ({ classList: { toggle: () => {} } })
  };
}

function makeNoteInput(value) {
  const listeners = {};
  const input = {
    value,
    isConnected: true,
    addEventListener: (type, listener) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    }
  };
  input.dispatchInput = () => (listeners.input || []).forEach((listener) => listener({ target: input }));
  return input;
}

async function verifyChecklistHandlerReconcilesAllVisibleControls() {
  const controls = [makeTaskControl('first'), makeTaskControl('second')];
  let firstReject;
  let secondReject;
  let call = 0;
  const client = {
    id: 'client-handler',
    checklist: [{ id: 'first', done: false }, { id: 'second', done: false }]
  };
  const sandbox = {
    copyClientForSave: copy,
    setChecklistTaskVisualState: (cl, task, control) => { control.checked = task.done; },
    saveClientWithFeedback: () => new Promise((resolve, reject) => {
      call += 1;
      if (call === 1) firstReject = reject;
      else secondReject = reject;
    }),
    reconcileClientSave: (target, error) => {
      Object.keys(target).forEach((key) => delete target[key]);
      Object.assign(target, copy(error.clientSaveReconciledSnapshot));
      return true;
    }
  };
  const root = {
    querySelectorAll: (selector) => selector === '[data-toggle-work],[data-day-toggle-work]' ? controls : [],
    querySelector: () => null
  };
  vm.runInNewContext([
    functionSource('syncChecklistTaskControls'),
    functionSource('reconcileClientTask3View'),
    functionSource('toggleClientChecklistTask')
  ].join('\n'), sandbox);

  const first = sandbox.toggleClientChecklistTask(client, 'first', controls[0], root);
  const second = sandbox.toggleClientChecklistTask(client, 'second', controls[1], root);
  const staleError = new Error('first write failed');
  staleError.clientSaveIsLatest = false;
  firstReject(staleError);
  const latestError = new Error('second write failed');
  latestError.clientSaveIsLatest = true;
  latestError.clientSaveReconciledSnapshot = {
    id: 'client-handler',
    checklist: [{ id: 'first', done: false }, { id: 'second', done: false }]
  };
  secondReject(latestError);
  await Promise.allSettled([first, second]);
  assert.deepStrictEqual(controls.map((control) => control.checked), [false, false],
    'the actual checklist toggle handler must reconcile every visible optimistic control after the latest queued failure');
  assert.deepStrictEqual(client.checklist.map((task) => task.done), [false, false]);
}

async function verifyFeedbackTokensKeepNewerSaveVisible() {
  const states = [];
  let firstResolve;
  let secondResolve;
  let calls = 0;
  const element = {};
  const sandbox = {
    _saveFeedbackTokens: new WeakMap(),
    setAsyncVisualState: (target, state) => states.push(state),
    saveClientAndRefresh: () => new Promise((resolve) => {
      calls += 1;
      if (calls === 1) firstResolve = resolve;
      else secondResolve = resolve;
    }),
    showToast: () => {}
  };
  vm.runInNewContext(functionSource('saveClientWithFeedback'), sandbox);
  const first = sandbox.saveClientWithFeedback({}, element);
  const second = sandbox.saveClientWithFeedback({}, element);
  firstResolve({ isLatest: false });
  await first;
  assert.deepStrictEqual(states, ['saving', 'saving'],
    'a stale completion on the same control must not clear the newer save feedback');
  secondResolve({ isLatest: true });
  await second;
  assert.deepStrictEqual(states, ['saving', 'saving', 'saved']);
}

async function verifyNoteFailureStaysWithItsOriginLayer() {
  const oldTextarea = { value: 'edited', isConnected: false };
  const newTextarea = { value: 'new modal note', isConnected: true };
  const oldLayer = { isConnected: false };
  const newLayer = { isConnected: true };
  const client = { id: 'client-note', dailyNotes: { '2026-08-14': 'old note' } };
  const failure = new Error('save failed');
  failure.clientSaveIsLatest = true;
  failure.clientSaveReconciledSnapshot = { id: 'client-note', dailyNotes: { '2026-08-14': 'old note' } };
  const sandbox = {
    _dayNoteInputEditStates: new WeakMap(),
    copyClientForSave: copy,
    saveClientWithFeedback: async () => { throw failure; },
    reconcileClientSave: (target, error) => {
      Object.keys(target).forEach((key) => delete target[key]);
      Object.assign(target, copy(error.clientSaveReconciledSnapshot));
      return true;
    },
    document: { getElementById: () => newLayer }
  };
  vm.runInNewContext([
    functionSource('reconcileClientTask3View'),
    functionSource('saveDayNoteWithFeedback')
  ].join('\n'), sandbox);
  await sandbox.saveDayNoteWithFeedback(client, '2026-08-14', oldTextarea, oldLayer, {});
  assert.strictEqual(newTextarea.value, 'new modal note',
    'a failed note save from a closed modal must not mutate a newly opened modal');
  assert.strictEqual(client.dailyNotes['2026-08-14'], 'old note');
}

function makeMixedFailureHarness(id) {
  const key = '2026-08-14';
  const storedAtStart = {
    id,
    name: 'Mixed Failure Client',
    updatedAt: 1,
    checklist: [{ id: 'day-task', day: 1, done: false }],
    dailyNotes: { [key]: 'old note' }
  };
  let stored = copy(storedAtStart);
  const client = copy(storedAtStart);
  const workspaceControl = makeTaskControl('day-task');
  const dayControl = makeTaskControl('day-task');
  dayControl.getAttribute = (name) => name === 'data-day-toggle-work' ? 'day-task' : null;
  const totalCount = { textContent: '1 / 1 완료' };
  const sectionCount = { textContent: '1 / 1 완료' };
  const section = {
    querySelectorAll: (selector) => selector === '[data-toggle-work]' ? [workspaceControl] : [],
    querySelector: (selector) => selector === '.check-section-count' ? sectionCount : null
  };
  const appRoot = {
    isConnected: true,
    querySelectorAll: (selector) => {
      if (selector === '[data-toggle-work],[data-day-toggle-work]') return [workspaceControl];
      if (selector === '.check-section') return [section];
      return [];
    },
    querySelector: (selector) => selector === '.checklist-head-actions .count' ? totalCount : null
  };
  const noteInput = makeNoteInput('old note');
  const layer = {
    id: 'day-modal-layer',
    isConnected: true,
    querySelectorAll: (selector) => selector === '[data-toggle-work],[data-day-toggle-work]' ? [dayControl] : [],
    querySelector: () => null
  };
  const sandbox = {
    state: {
      clients: [{ id, name: storedAtStart.name, updatedAt: storedAtStart.updatedAt }],
      currentClient: client,
      view: 'clientDetail'
    },
    app: appRoot,
    document: { getElementById: (elementId) => elementId === 'day-modal-layer' ? layer : null },
    Date: { now: () => 400 },
    readS: async () => ({ status: 'found', value: copy(stored) }),
    setS: async (storageKey, value) => { stored = copy(value); return true; },
    setP: async () => false,
    delS: async () => { throw new Error('a confirmed stored client must be restored, not deleted'); },
    render: () => { throw new Error('mixed Task 3 failures must not rerender the workspace'); },
    setAsyncVisualState: () => {},
    showToast: () => {},
    setChecklistTaskVisualState: (target, task, control) => { control.checked = task.done; }
  };
  vm.runInNewContext([
    'var _clientSaveQueue=Promise.resolve(), _clientSaveVersions={}, _clientSaveBaselines={}, _clientSaveNoteReconciliations={}, _saveFeedbackTokens=new WeakMap(), _dayNoteInputEditStates=new WeakMap();',
    functionSource('copyClientForSave'),
    functionSource('clientIndexEntry'),
    functionSource('reconcileClientSave'),
    functionSource('persistClientSnapshot'),
    functionSource('saveClientAndRefresh'),
    functionSource('saveClientWithFeedback'),
    functionSource('syncChecklistTaskControls'),
    functionSource('reconcileClientTask3View'),
    functionSource('toggleClientChecklistTask'),
    functionSource('saveDayNoteWithFeedback')
  ].join('\n'), sandbox);
  return {
    key,
    storedAtStart,
    getStored: () => stored,
    client,
    workspaceControl,
    dayControl,
    totalCount,
    sectionCount,
    noteInput,
    layer,
    sandbox,
    taskContext: { root: layer, layer, noteInput, noteKey: key }
  };
}

function assertMixedFailureReconciled(harness) {
  assert.strictEqual(harness.client.checklist[0].done, false, 'the model task must match the confirmed baseline');
  assert.strictEqual(harness.client.dailyNotes[harness.key], 'old note', 'the model note must match the confirmed baseline');
  assert.strictEqual(harness.getStored().checklist[0].done, false, 'client storage must be compensated to the confirmed task');
  assert.strictEqual(harness.getStored().dailyNotes[harness.key], 'old note', 'client storage must retain the confirmed note');
  assert.strictEqual(harness.sandbox._clientSaveBaselines[harness.client.id], undefined,
    'the settled queue baseline must not retain optimistic state');
  assert.strictEqual(harness.sandbox._clientSaveNoteReconciliations[harness.client.id], undefined,
    'the settled queue must not retain note reconciliation state');
  assert.strictEqual(harness.workspaceControl.checked, false, 'the visible checklist control must match the reconciled model');
  assert.strictEqual(harness.dayControl.checked, false, 'the visible day-task control must match the reconciled model');
  assert.strictEqual(harness.noteInput.value, 'old note', 'the original current note input must match the reconciled model');
  assert.strictEqual(harness.totalCount.textContent, '0 / 1 완료', 'the visible total must match the reconciled model');
  assert.strictEqual(harness.sectionCount.textContent, '0 / 1 완료', 'the visible section total must match the reconciled model');
}

async function verifyTaskThenNoteBothFailReconcilesCurrentView() {
  const harness = makeMixedFailureHarness('client-task-note');
  const taskSave = harness.sandbox.toggleClientChecklistTask(
    harness.client,
    'day-task',
    harness.dayControl,
    harness.layer,
    harness.taskContext
  );
  harness.noteInput.value = 'new note';
  const noteSave = harness.sandbox.saveDayNoteWithFeedback(
    harness.client,
    harness.key,
    harness.noteInput,
    harness.layer,
    {},
    () => { throw new Error('a failed note save must not close the modal'); }
  );
  await Promise.all([taskSave, noteSave]);
  assertMixedFailureReconciled(harness);
}

async function verifyNoteThenTaskBothFailReconcilesCurrentView() {
  const harness = makeMixedFailureHarness('client-note-task');
  harness.noteInput.value = 'new note';
  const noteSave = harness.sandbox.saveDayNoteWithFeedback(
    harness.client,
    harness.key,
    harness.noteInput,
    harness.layer,
    {},
    () => { throw new Error('a failed note save must not close the modal'); }
  );
  const taskSave = harness.sandbox.toggleClientChecklistTask(
    harness.client,
    'day-task',
    harness.dayControl,
    harness.layer,
    harness.taskContext
  );
  await Promise.all([noteSave, taskSave]);
  assertMixedFailureReconciled(harness);
}

async function verifyTaskFailureAfterUnsavedTypingPreservesTyping() {
  const harness = makeMixedFailureHarness('client-task-only-typing');
  const taskSave = harness.sandbox.toggleClientChecklistTask(
    harness.client,
    'day-task',
    harness.dayControl,
    harness.layer,
    harness.taskContext
  );
  harness.noteInput.value = 'typing after task save began';
  harness.noteInput.dispatchInput();
  await taskSave;
  assert.strictEqual(harness.client.checklist[0].done, false, 'the failed task must reconcile the model');
  assert.strictEqual(harness.getStored().checklist[0].done, false, 'the failed task must compensate storage');
  assert.strictEqual(harness.noteInput.value, 'typing after task save began',
    'a task-only failure must never overwrite unsaved note typing');
}

async function verifyUnchangedNoteInputRestoresAfterFailure() {
  const harness = makeMixedFailureHarness('client-note-unchanged');
  harness.noteInput.value = 'submitted note';
  harness.noteInput.dispatchInput();
  await harness.sandbox.saveDayNoteWithFeedback(
    harness.client,
    harness.key,
    harness.noteInput,
    harness.layer,
    {},
    () => { throw new Error('a failed note save must not close the modal'); }
  );
  assert.strictEqual(harness.client.dailyNotes[harness.key], 'old note', 'the failed note must reconcile the model');
  assert.strictEqual(harness.getStored().dailyNotes[harness.key], 'old note', 'the failed note must compensate storage');
  assert.strictEqual(harness.noteInput.value, 'old note',
    'an unchanged input from the failed note save must display the reconciled note');
}

async function verifyNewerTypingDuringFailedNoteSaveIsPreserved() {
  const harness = makeMixedFailureHarness('client-note-newer-typing');
  harness.noteInput.value = 'submitted note';
  harness.noteInput.dispatchInput();
  const noteSave = harness.sandbox.saveDayNoteWithFeedback(
    harness.client,
    harness.key,
    harness.noteInput,
    harness.layer,
    {},
    () => { throw new Error('a failed note save must not close the modal'); }
  );
  harness.noteInput.value = 'newer typing during the failed save';
  harness.noteInput.dispatchInput();
  await noteSave;
  assert.strictEqual(harness.client.dailyNotes[harness.key], 'old note', 'the failed note must still reconcile the model');
  assert.strictEqual(harness.getStored().dailyNotes[harness.key], 'old note', 'the failed note must still compensate storage');
  assert.strictEqual(harness.noteInput.value, 'newer typing during the failed save',
    'newer DOM edits must survive note failure reconciliation');
}

Promise.all([
  verifyChecklistHandlerReconcilesAllVisibleControls(),
  verifyFeedbackTokensKeepNewerSaveVisible(),
  verifyNoteFailureStaysWithItsOriginLayer(),
  verifyNoteThenTaskBothFailReconcilesCurrentView(),
  verifyTaskThenNoteBothFailReconcilesCurrentView(),
  verifyTaskFailureAfterUnsavedTypingPreservesTyping(),
  verifyUnchangedNoteInputRestoresAfterFailure(),
  verifyNewerTypingDuringFailedNoteSaveIsPreserved()
]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
