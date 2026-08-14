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
assert.match(source, /function persistClientSnapshot\(snapshot\)/);
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
    getS: async () => copy(stored),
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
    'var _clientSaveQueue=Promise.resolve(), _clientSaveVersions={};',
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
    getS: async () => copy(original),
    setS: async (key, value) => { rollbackWrites.push(copy(value)); return true; },
    setP: async () => false,
    delS: async () => true,
    render: () => { throw new Error('failed saves must not rerender the workspace'); }
  };
  vm.runInNewContext([
    'var _clientSaveQueue=Promise.resolve(), _clientSaveVersions={};',
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
