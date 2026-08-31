const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');

assert.doesNotMatch(html, /rs:team-token/, 'the browser must not retain the team password');
assert.doesNotMatch(html, /localStorage\.setItem\(AUTH_KEY/, 'credentials must not be written to localStorage');
assert.doesNotMatch(html, /["']x-team-token["']/, 'staff requests must not send the legacy token header');
assert.doesNotMatch(html, /Authorization['"]?\s*:\s*['"]?Bearer/, 'staff requests must not send bearer credentials');
assert.match(html, /fetch\("\/api\/auth\?action=logout"/, 'logout must call the server session action');
assert.match(html, /credentials:\s*["']same-origin["']/, 'browser requests must include same-origin cookies');
assert.match(html, /data\.ok\s*!==\s*true/, 'login must reject responses that do not have the cookie-session success shape');
assert.match(html, /handleSessionExpired\(/, '401 responses must transition to the session-expired login state');
const staffContractSave = html.match(/async mutatePublicContract\([\s\S]*?\n    \},/);
assert.ok(staffContractSave, 'the staff contract save transport must exist');
assert.match(staffContractSave[0], /staffFetch\("\/api\/data"/, 'staff contract saves must use cookie credentials');
assert.match(html, /function createSessionExpiredError\(/, 'staff transport must use a distinct session-expired error');
assert.match(html, /var sessionGeneration\s*=\s*0/, 'staff work must have a generation guard');
assert.match(html, /var sessionExpiryInFlight\s*=\s*false/, 'concurrent 401 handling must be guarded');
assert.match(html, /var loginInFlight\s*=\s*null/, 'login must deduplicate click and Enter submissions');
assert.match(html, /if\(isDemoMode\(\) \|\| sessionExpiryInFlight\) return;/, 'only the first 401 may snapshot and replace the view');
assert.match(html, /if\(!sessionDraft \|\| isDemoMode\(\)\) return;/, 'staff drafts must never restore into demo mode');
assert.match(html, /sessionDraft=null;\s*workspaceMode = "demo"/, 'demo entry must quarantine an expired staff draft');
assert.match(html, /if\(!response\.ok\)/, 'logout must check the server response before leaving the staff view');
assert.match(html, /collectContractFromForm\(state\.currentContract\)/, 'draft capture must preserve contract signatures through the existing canvas serializer');
assert.match(html, /function createStaleSessionError\(/, 'stale requests must be distinguishable from a real session expiry');
assert.match(html, /function captureProtectedOverlays\(/, 'session expiry must capture protected body overlays');
assert.match(html, /function restoreProtectedOverlays\(/, 'successful re-login must restore protected overlay drafts');
assert.match(html, /function isSessionControlError\(/, 'all storage wrappers must share the session control-flow classifier');

function sourceFor(name) {
  const match = html.match(new RegExp(`(async function ${name}\\([\\s\\S]*?\\n  \\})`));
  assert.ok(match, `${name} must be a top-level async helper`);
  return match[1];
}

function sourceBetween(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `expected source region ${start}…${end}`);
  return html.slice(from, to);
}

['staffDataGet', 'staffFetch'].forEach((name) => {
  const source = sourceFor(name);
  assert.ok(source.indexOf('if(!isCurrentStaffGeneration(generation))') < source.indexOf('if(res.status===401)'),
    `${name} must classify a stale response before handling a 401`);
});

const calls = [];
const sandbox = {
  sessionGeneration: 0,
  isCurrentStaffGeneration() { return true; },
  createSessionExpiredError() { return Object.assign(new Error('expired'), { code: 'session_expired' }); },
  fetch: async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/auth') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (url === '/api/data?key=clients-index') return { ok: true, status: 200, json: async () => ({ value: '[]' }) };
    if (url === '/api/auth?action=logout') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    throw new Error(`unexpected URL: ${url}`);
  },
  handleSessionExpired() { throw new Error('unexpected session expiry'); }
};

vm.runInNewContext([
  sourceFor('loginWithPassword'),
  sourceFor('staffDataGet'),
  sourceFor('logoutStaffSession')
].join('\n'), sandbox);

(async () => {
  const login = await sandbox.loginWithPassword('correct horse battery staple');
  assert.strictEqual(login.ok, true, 'the cookie login response must be accepted without a token field');
  await sandbox.staffDataGet('clients-index');
  await sandbox.logoutStaffSession();

  assert.deepStrictEqual(
    calls.map((call) => call.url),
    ['/api/auth', '/api/data?key=clients-index', '/api/auth?action=logout'],
    'the browser flow must login, use a protected endpoint, then revoke the server session'
  );
  calls.forEach((call) => {
    assert.strictEqual(call.options.credentials, 'same-origin', `${call.url} must use cookie credentials`);
    assert.ok(!call.options.headers || !Object.prototype.hasOwnProperty.call(call.options.headers, 'x-team-token'));
    assert.ok(!call.options.headers || !Object.prototype.hasOwnProperty.call(call.options.headers, 'Authorization'));
  });

  let preserveCount = 0;
  const expiryRenders = [];
  const expirySandbox = {
    sessionExpiryInFlight: false,
    sessionGeneration: 4,
    workspaceMode: 'staff',
    state: { view: 'edit' },
    isDemoMode() { return false; },
    preserveVisibleDrafts() { preserveCount += 1; },
    renderLogin(message) { expiryRenders.push(message); },
  };
  vm.runInNewContext(sourceBetween('  function handleSessionExpired()', '  async function loginWithPassword'), expirySandbox);
  expirySandbox.handleSessionExpired();
  expirySandbox.handleSessionExpired();
  assert.strictEqual(preserveCount, 1, 'concurrent 401s must snapshot the first visible draft only once');
  assert.strictEqual(expiryRenders.length, 1, 'concurrent 401s must not replace the login view again');
  assert.strictEqual(expirySandbox.state.view, 'login');
  assert.strictEqual(expirySandbox.sessionGeneration, 5, 'the first 401 must invalidate stale staff continuations');

  let resolveOldResponse;
  let staleExpiryCalls = 0;
  const staleResponseSandbox = {
    sessionGeneration: 7,
    sessionExpiryInFlight: false,
    fetch() { return new Promise((resolve) => { resolveOldResponse = resolve; }); },
    isCurrentStaffGeneration(generation) { return generation === this.sessionGeneration && !this.sessionExpiryInFlight; },
    createSessionExpiredError() { return Object.assign(new Error('expired'), { code: 'session_expired' }); },
    handleSessionExpired() { staleExpiryCalls += 1; }
  };
  vm.runInNewContext([
    sourceBetween('  function createStaleSessionError()', '  function isCurrentStaffGeneration'),
    sourceFor('staffDataGet')
  ].join('\n'), staleResponseSandbox);
  const oldRequest = staleResponseSandbox.staffDataGet('clients-index');
  staleResponseSandbox.sessionGeneration = 9; // expiry then successful re-login created a new generation
  resolveOldResponse({ status: 401 });
  await assert.rejects(oldRequest, (error) => error && error.code === 'stale_session_request',
    'a late 401 from the old generation must be stale, not a new session expiry');
  assert.strictEqual(staleExpiryCalls, 0, 'a late 401 must not expire the newly authenticated session');
  assert.strictEqual(staleResponseSandbox.sessionGeneration, 9, 'a late 401 must leave the re-login generation intact');

  const renewalModal = { classList: { shown: true, contains(name) { return name === 'show' && this.shown; }, remove(name) { if (name === 'show') this.shown = false; }, add(name) { if (name === 'show') this.shown = true; } } };
  const dayNote = { value: 'handoff details' };
  const dayLayer = {
    _staffOverlayDraft: { client: { id: 'daily-client', name: 'Daily client', checklist: [] }, clientId: 'daily-client', key: '2026-08-31' },
    querySelector(selector) { return selector === '#daily-note' ? dayNote : null; },
    remove() { this.removed = true; overlayElements['day-modal-layer'] = null; }
  };
  const renewalDateStep = { hidden: true };
  const renewalStartDate = { value: '2026-09-07' };
  const renewalSetOptions = { querySelectorAll() { return [{ getAttribute() { return 'set-a'; }, click() { overlayRestores.push('set-selection'); } }]; } };
  const overlayElements = {
    'renewal-modal': renewalModal,
    'renewal-date-step': renewalDateStep,
    'renewal-start-date': renewalStartDate,
    'renewal-set-options': renewalSetOptions,
    'day-modal-layer': dayLayer
  };
  const overlayRestores = [];
  const overlaySandbox = {
    state: { currentClient: { id: 'renewal-client', name: 'Renewal client' }, renewalClientId: 'renewal-client', renewalSelectedSetId: 'set-a' },
    isDemoMode() { return false; },
    copyClientForSave(value) { return JSON.parse(JSON.stringify(value)); },
    document: { getElementById(id) { return overlayElements[id] || null; } },
    renewalDialog(client) { overlayRestores.push({ renewal: client.id }); renewalModal.classList.add('show'); },
    openDayModal(client, key) {
      overlayRestores.push({ daily: client.id, key });
      overlayElements['day-modal-layer'] = { querySelector() { return dayNote; }, saveButton: { onclick: null } };
      overlayElements['daily-note'] = dayNote;
      dayNote.value = '';
      overlayElements['day-modal-layer'].saveButton.onclick = () => overlayRestores.push('daily-save');
    }
  };
  vm.runInNewContext(sourceBetween('  function captureProtectedOverlays()', '  function restoreVisibleDrafts()'), overlaySandbox);
  let overlaySnapshots = null;
  overlaySandbox.preserveVisibleDrafts = () => { overlaySnapshots = overlaySandbox.captureProtectedOverlays(); };
  overlaySandbox.renderLogin = () => { overlayRestores.push('login'); };
  overlaySandbox.sessionExpiryInFlight = false;
  overlaySandbox.sessionGeneration = 1;
  overlaySandbox.workspaceMode = 'staff';
  overlaySandbox.handleSessionExpired = null;
  vm.runInNewContext(sourceBetween('  function handleSessionExpired()', '  async function loginWithPassword'), overlaySandbox);
  overlaySandbox.handleSessionExpired();
  assert.strictEqual(renewalModal.classList.shown, false, 'expiry must hide the body-level renewal modal before login renders');
  assert.strictEqual(dayLayer.removed, true, 'expiry must remove the dynamically appended daily-note modal before login renders');
  assert.strictEqual(overlaySnapshots.renewal.startDate, '2026-09-07', 'renewal inputs must be retained in the memory draft');
  assert.strictEqual(overlaySnapshots.daily.note, 'handoff details', 'daily-note text must be retained in the memory draft');
  overlaySandbox.restoreProtectedOverlays(overlaySnapshots);
  assert.ok(overlayRestores.some((entry) => entry && entry.renewal === 'renewal-client'), 're-login must reopen the renewal modal through its normal event-binding path');
  assert.ok(overlayRestores.some((entry) => entry && entry.daily === 'daily-client'), 're-login must reopen the daily-note modal through its normal event-binding path');
  assert.strictEqual(dayNote.value, 'handoff details', 'reopened daily-note modal must restore the authored note');
  assert.ok(overlayRestores.includes('set-selection'), 'reopened renewal modal must restore its selected checklist set via its normal handler');
  overlaySandbox.isDemoMode = () => true;
  overlayRestores.length = 0;
  overlaySandbox.restoreProtectedOverlays(overlaySnapshots);
  assert.strictEqual(overlayRestores.length, 0, 'demo mode must discard overlay drafts instead of reopening staff overlays');

  const controlErrorCodes = ['session_expired', 'stale_session_request'];
  const adapterSandbox = {
    isDemoMode() { return false; },
    console: { error() {} },
    storageBackend: {},
  };
  vm.runInNewContext([
    sourceBetween('  function isSessionControlError(error)', '  function isCurrentStaffGeneration'),
    sourceFor('readS'), sourceFor('getP'), sourceFor('setP'), sourceFor('getS'), sourceFor('setS'), sourceFor('delS'),
    sourceFor('reserveGuideIssue'), sourceFor('mutatePublicGuide'), sourceFor('readPublicGuide'), sourceFor('mutatePublicContract')
  ].join('\n'), adapterSandbox);
  for (const code of controlErrorCodes) {
    const controlError = Object.assign(new Error(code), { code });
    adapterSandbox.storageBackend = {
      get() { throw controlError; }, set() { throw controlError; }, delete() { throw controlError; }, reserveGuideIssue() { throw controlError; },
      mutatePublicGuide() { throw controlError; }, getPublicGuide() { throw controlError; }, mutatePublicContract() { throw controlError; }
    };
    for (const [name, invoke] of [
      ['readS', () => adapterSandbox.readS('client:one')], ['getP', () => adapterSandbox.getP('clients-index')],
      ['setP', () => adapterSandbox.setP('clients-index', [])], ['getS', () => adapterSandbox.getS('client:one')],
      ['setS', () => adapterSandbox.setS('client:one', {})], ['delS', () => adapterSandbox.delS('client:one')],
      ['reserveGuideIssue', () => adapterSandbox.reserveGuideIssue('client-one')], ['mutatePublicGuide', () => adapterSandbox.mutatePublicGuide('guide-one', {}, false)],
      ['readPublicGuide', () => adapterSandbox.readPublicGuide('guide-one')], ['mutatePublicContract', () => adapterSandbox.mutatePublicContract('contract-one', {}, false)]
    ]) {
      await assert.rejects(invoke, (error) => error === controlError, `${name} must rethrow ${code} instead of converting session control flow`);
    }
  }

  const persistCalls = [];
  const persistStale = Object.assign(new Error('stale'), { code: 'stale_session_request' });
  const persistSandbox = {
    state: { clients: [] },
    copyClientForSave(value) { return JSON.parse(JSON.stringify(value)); },
    clientIndexEntry(client) { return { id: client.id }; },
    async readS() { return { status: 'found', value: { id: 'client-one', name: 'before' } }; },
    async setS(key) { persistCalls.push(`set:${key}`); return { key }; },
    async setP(key) { persistCalls.push(`set:${key}`); throw persistStale; },
    async delS(key) { persistCalls.push(`del:${key}`); return { key }; }
  };
  vm.runInNewContext(sourceFor('persistClientSnapshot'), persistSandbox);
  await assert.rejects(() => persistSandbox.persistClientSnapshot({ id: 'client-one', name: 'after' }, { id: 'client-one', name: 'before' }),
    (error) => error === persistStale, 'persistClientSnapshot must preserve a stale control-flow error');
  assert.deepStrictEqual(persistCalls, ['set:client:client-one', 'set:clients-index'],
    'a stale index write must not trigger rollback or any follow-on storage write');

  const publicSaveSandbox = {
    publicGuideSaveChain: Promise.resolve(true),
    localStorage: { setItem() {} }, sessionStorage: { setItem() {} },
    isSessionControlError(error) { return error && (error.code === 'session_expired' || error.code === 'stale_session_request'); },
    async mutatePublicGuide() { throw persistStale; }
  };
  vm.runInNewContext(sourceFor('savePublicGuide'), publicSaveSandbox);
  await assert.rejects(() => publicSaveSandbox.savePublicGuide({ id: 'guide-one', answers: {} }, false),
    (error) => error === persistStale, 'the public save wrapper must not convert stale control flow into a failed-save result');

  const unauthorized = Object.assign(new Error('expired'), { code: 'session_expired' });
  const readerSandbox = {
    isDemoMode() { return false; },
    storageBackend: { async get() { throw unauthorized; } },
    isSessionControlError(error) { return error && (error.code === 'session_expired' || error.code === 'stale_session_request'); }
  };
  vm.runInNewContext(sourceBetween('  async function readS(', '  async function getP('), readerSandbox);
  await assert.rejects(() => readerSandbox.readS('client:stale'), /expired/, 'readS must propagate session expiry rather than turn it into data state');

  const reservationSandbox = {
    isDemoMode() { return false; },
    storageBackend: { async reserveGuideIssue() { throw unauthorized; } },
    isSessionControlError(error) { return error && (error.code === 'session_expired' || error.code === 'stale_session_request'); },
    console: { error() {} }
  };
  vm.runInNewContext(sourceBetween('  async function reserveGuideIssue(', '  async function mutatePublicGuide('), reservationSandbox);
  await assert.rejects(() => reservationSandbox.reserveGuideIssue('client:stale'), /expired/, 'guide reservation must propagate session expiry rather than report an ordinary failure');

  let stalePaints = 0;
  const renderSandbox = {
    sessionExpiryInFlight: true,
    state: { view: 'dashboard' },
    syncChecklistSetEditor() { throw new Error('stale render must stop before syncing'); },
    renderDashboard() { stalePaints += 1; }
  };
  vm.runInNewContext(sourceBetween('  function render()', '  function renderKeywordTool()'), renderSandbox);
  renderSandbox.render();
  assert.strictEqual(stalePaints, 0, 'a pre-expiry render continuation must not repaint protected UI');

  const idlessText = { id: '', value: 'channel copy', checked: false, selectedIndex: -1, textContent: '', tagName: 'INPUT', getAttribute() { return null; } };
  const select = { id: '', value: 'renewal', checked: false, selectedIndex: 1, textContent: '', tagName: 'SELECT', getAttribute() { return null; } };
  const checkbox = { id: 'f-exclude-weekends', value: 'on', checked: true, selectedIndex: -1, textContent: '', tagName: 'INPUT', getAttribute() { return null; } };
  const richText = { id: '', value: '', checked: false, selectedIndex: -1, textContent: 'editable note', tagName: 'DIV', getAttribute(name) { return name === 'contenteditable' ? 'true' : null; } };
  const controls = [idlessText, select, checkbox, richText];
  const controlSandbox = {
    app: { querySelectorAll() { return controls; } },
    document: { getElementById(id) { return controls.find((control) => control.id === id) || null; } },
    Array
  };
  vm.runInNewContext(sourceBetween('  function captureVisibleControls()', '  function preserveVisibleDrafts()'), controlSandbox);
  const capturedControls = controlSandbox.captureVisibleControls();
  idlessText.value = ''; select.selectedIndex = 0; checkbox.checked = false; richText.textContent = '';
  controlSandbox.restoreVisibleControls(capturedControls);
  assert.strictEqual(idlessText.value, 'channel copy', 'id-less report/channel controls must restore by stable position');
  assert.strictEqual(select.selectedIndex, 1, 'select state must survive re-login');
  assert.strictEqual(checkbox.checked, true, 'checkbox state must survive re-login');
  assert.strictEqual(richText.textContent, 'editable note', 'contenteditable drafts must survive re-login');

  const signatureCanvas = { id: 'contract-signature' };
  const signatureSandbox = {
    state: { view: 'clientForm', currentContract: { id: 'contract-one' } }, sessionDraft: null,
    app: { querySelector() { return null; }, querySelectorAll() { return []; } },
    document: { getElementById(id) { return id === 'contract-signature' ? signatureCanvas : null; } },
    syncChecklistSetEditor() {},
    collectContractFromForm() { return { id: 'contract-one', signatureDataUrl: 'data:image/png;base64,signature' }; },
    Array
  };
  vm.runInNewContext(sourceBetween('  function captureReportDraft()', '  function restoreVisibleDrafts()'), signatureSandbox);
  signatureSandbox.preserveVisibleDrafts();
  assert.strictEqual(signatureSandbox.sessionDraft.currentContract.signatureDataUrl, 'data:image/png;base64,signature',
    'signature canvas data must be retained in the in-memory draft snapshot');

  let demoLoads = 0;
  const demoSandbox = {
    sessionGeneration: 3, sessionExpiryInFlight: true, sessionDraft: { view: 'edit' }, workspaceMode: 'staff', demoWorkspace: null,
    sessionStorage: { setItem() {} },
    ensureDemoWorkspace() {},
    async loadWorkspace() { demoLoads += 1; },
  };
  vm.runInNewContext(sourceBetween('  async function enterDemoMode()', '  function leaveDemoMode()'), demoSandbox);
  await demoSandbox.enterDemoMode();
  assert.strictEqual(demoSandbox.sessionDraft, null, 'staff draft snapshots must be discarded before demo loads');
  assert.strictEqual(demoSandbox.workspaceMode, 'demo');
  assert.strictEqual(demoLoads, 1);

  const logoutMessages = [];
  const logoutSandbox = {
    async logoutStaffSession() { return { ok: false, status: 503 }; },
    console: { error() {} }, showToast(message) { logoutMessages.push(message); },
    state: { view: 'dashboard' }, workspaceMode: 'staff', sessionGeneration: 0, sessionDraft: { view: 'edit' }, demoWorkspace: null,
    sessionStorage: { removeItem() {} }, renderLogin() {}
  };
  vm.runInNewContext(sourceBetween('  async function staffLogout()', '  async function enterDemoMode()'), logoutSandbox);
  assert.strictEqual(await logoutSandbox.staffLogout(), false, 'failed server logout must be reported as a failure');
  assert.strictEqual(logoutSandbox.state.view, 'dashboard', 'failed logout must retain the authenticated view');
  assert.match(logoutMessages[0], /다시 시도/, 'failed logout must provide an actionable retry message');

  let resolveLogin;
  let loginRequests = 0;
  let workspaceLoads = 0;
  const loginSandbox = {
    loginInFlight: null, sessionExpiryInFlight: true, sessionGeneration: 1,
    loginWithPassword() { loginRequests += 1; return new Promise((resolve) => { resolveLogin = resolve; }); },
    async loadWorkspace() { workspaceLoads += 1; }
  };
  vm.runInNewContext(sourceBetween('  async function beginStaffLogin(password)', '  async function staffDataGet('), loginSandbox);
  const firstLogin = loginSandbox.beginStaffLogin('pw');
  const secondLogin = loginSandbox.beginStaffLogin('pw');
  assert.strictEqual(loginRequests, 1, 'click and Enter must share one in-flight login request');
  resolveLogin({ ok: true });
  await Promise.all([firstLogin, secondLogin]);
  assert.strictEqual(workspaceLoads, 1, 'deduplicated login must load the workspace once');
  console.log('browser cookie session flow: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
