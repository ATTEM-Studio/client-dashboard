const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function fakeStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function loadDemoData() {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync('demo-data.js', 'utf8'), sandbox);
  return sandbox.DemoData;
}

const DemoData = loadDemoData();
const now = new Date('2026-08-17T00:00:00+09:00');
const storage = fakeStorage();
const seed = DemoData.createDemoSeed(now);
const requiredDemoExports = [
  'DEMO_STORAGE_KEY', 'DEMO_SCHEMA_VERSION', 'createDemoSeed', 'loadDemoWorkspace',
  'saveDemoValue', 'resetDemoWorkspace'
];
const requiredSeedKeys = [
  'clients-index', 'reports-index', 'contracts-index', 'contract-base-terms-template', 'checklist-sets'
];

requiredDemoExports.forEach((name) => {
  assert.ok(Object.prototype.hasOwnProperty.call(DemoData, name), `DemoData must export ${name}`);
});
['createDemoSeed', 'loadDemoWorkspace', 'saveDemoValue', 'resetDemoWorkspace'].forEach((name) => {
  assert.strictEqual(typeof DemoData[name], 'function', `DemoData.${name} must be callable`);
});
requiredSeedKeys.forEach((key) => {
  assert.ok(Object.prototype.hasOwnProperty.call(seed.values, key), `the demo seed must include ${key}`);
});

assert.strictEqual(seed.version, 1, 'the browser demo workspace must use schema version 1');
assert.strictEqual(seed.values['clients-index'].length, 3, 'the demo starts with three fictional clients');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(seed.values['clients-index'].map((client) => client.demoStage))),
  ['upcoming', 'active-week-2', 'renewal-week-4'],
  'the three client stages demonstrate start-soon, active, and renewal work'
);

DemoData.loadDemoWorkspace(storage, now);
DemoData.saveDemoValue(storage, 'reports-index', [{ id: 'demo-report-edit', demo: true }]);
assert.strictEqual(
  DemoData.loadDemoWorkspace(storage, now).values['reports-index'][0].id,
  'demo-report-edit',
  'saved demo edits must persist after a reload'
);

DemoData.resetDemoWorkspace(storage, now);
assert.notStrictEqual(
  DemoData.loadDemoWorkspace(storage, now).values['reports-index'][0] &&
    DemoData.loadDemoWorkspace(storage, now).values['reports-index'][0].id,
  'demo-report-edit',
  'reset must restore the pristine fictional seed'
);

storage.setItem(DemoData.DEMO_STORAGE_KEY, '{not valid json');
const recovered = DemoData.loadDemoWorkspace(storage, now);
assert.strictEqual(recovered.recovered, true, 'corrupt local data must be recovered with a new demo seed');
assert.strictEqual(recovered.values['clients-index'].length, 3);
assert.doesNotThrow(() => JSON.parse(storage.getItem(DemoData.DEMO_STORAGE_KEY)));

const unavailableStorage = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
  removeItem() { throw new Error('blocked'); }
};
const memoryWorkspace = DemoData.loadDemoWorkspace(unavailableStorage, now);
assert.strictEqual(memoryWorkspace.persistent, false, 'storage failures must fall back to a non-persistent memory workspace');
assert.strictEqual(memoryWorkspace.values['clients-index'].length, 3);

const html = fs.readFileSync('index.html', 'utf8');
assert.match(html, /id="btn-enter-demo"/, 'login must offer password-free demo entry');
assert.match(html, /function enterDemoMode\(\)/, 'demo entry transition must exist');
assert.match(html, /function resetDemoMode\(\)/, 'demo reset action must exist');
assert.match(html, /function leaveDemoMode\(\)/, 'demo-to-staff transition must exist');
assert.match(html, /id="btn-menu-logout"/, 'staff dashboard menu must expose logout');
assert.match(html, /DEMO/, 'demo chrome must visibly identify demo mode');
assert.match(html, /<script src="demo-data\.js"><\/script>\s*<script>/,
  'the dashboard must load demo storage helpers before its inline application script');
const storageStart = html.indexOf('  var workspaceMode = sessionStorage.getItem(\'rs:workspace-mode\')');
const modeEnd = html.indexOf('\n  function authHeaders', storageStart);
const helperStart = html.indexOf('  async function readS(', modeEnd);
const storageEnd = html.indexOf('  async function reserveGuideIssue(', helperStart);
assert.ok(storageStart >= 0 && modeEnd > storageStart && helperStart > modeEnd && storageEnd > helperStart,
  'mode-aware storage helpers must exist');
const storageSource = html.slice(storageStart, modeEnd) + html.slice(helperStart, storageEnd);
const fetches = [];
const browserStorage = fakeStorage();
const helperSandbox = {
  DemoData,
  localStorage: browserStorage,
  sessionStorage: { getItem(key) { return key === 'rs:workspace-mode' ? 'demo' : null; } },
  storageBackend: {
    async get() { fetches.push('get'); return null; },
    async set() { fetches.push('set'); return null; },
    async delete() { fetches.push('delete'); return null; }
  },
  console
};
vm.runInNewContext(storageSource, helperSandbox);
(async () => {
  const demoClients = await helperSandbox.getP('clients-index');
  assert.strictEqual(demoClients.length, 3, 'demo reads must use the browser workspace');
  demoClients.pop();
  assert.strictEqual((await helperSandbox.getP('clients-index')).length, 3,
    'demo reads must return a clone rather than a mutable workspace reference');
  assert.ok(await helperSandbox.setS('client:demo-write', { id: 'demo-write', demo: true }),
    'demo writes must report success without using the staff transport');
  const found = await helperSandbox.readS('client:demo-client-moss');
  assert.strictEqual(found.status, 'found', 'demo readS must read the browser workspace');
  assert.strictEqual(found.value.id, 'demo-client-moss');
  const deletion = await helperSandbox.delS('client:demo-client-moss');
  assert.strictEqual(deletion.key, 'client:demo-client-moss', 'demo delete must identify the local value');
  assert.strictEqual(deletion.deleted, true, 'demo delete must report a local deletion');
  assert.strictEqual((await helperSandbox.readS('client:demo-client-moss')).status, 'missing',
    'demo delete must remove the browser-only value');
  assert.strictEqual(fetches.length, 0, 'demo storage must not call the Redis transport');
  assert.strictEqual(DemoData.loadDemoWorkspace(browserStorage, now).values['client:demo-write'].id, 'demo-write');
  console.log('browser demo workspace storage: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
