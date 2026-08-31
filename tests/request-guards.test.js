const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const dataApi = require('../api/data');
const guideApi = require('../api/guide');
const { issueSession } = require('../api/_session');
const html = fs.readFileSync('index.html', 'utf8');

process.env.TEAM_PASSWORD = 'request-guard-password';
process.env.KV_REST_API_URL = 'https://redis.example.test';
process.env.KV_REST_API_TOKEN = 'request-guard-token';

function response() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

function sessionHeaders() {
  const res = response();
  issueSession(res);
  return { cookie: String(res.headers['set-cookie']).split(';')[0] };
}

async function invoke(request, fetchImpl) {
  const previousFetch = global.fetch;
  global.fetch = fetchImpl;
  const res = response();
  try {
    await dataApi({ query: {}, headers: {}, ...request }, res);
  } finally {
    global.fetch = previousFetch;
  }
  return res;
}

function emptyRedis() {
  return async () => ({ ok: true, async json() { return { result: null }; }, async text() { return ''; } });
}

test('pending action helper shares a single in-flight request and permits a safe retry', async () => {
  const match = html.match(/(var pendingActions = new Map\(\);[\s\S]*?\n  \})/);
  assert.ok(match, 'withPendingAction must be available to document-specific write handlers');
  const sandbox = { Map, Promise };
  vm.runInNewContext(match[1], sandbox);

  let calls = 0;
  let release;
  const action = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  const first = sandbox.withPendingAction('guide:submit:guide_one', action);
  const second = sandbox.withPendingAction('guide:submit:guide_one', action);
  assert.strictEqual(first, second, 'double guide submits must share one transport Promise');
  await Promise.resolve();
  assert.strictEqual(calls, 1);
  release('saved');
  assert.strictEqual(await first, 'saved');
  assert.strictEqual(await sandbox.withPendingAction('guide:submit:guide_one', async () => {
    calls += 1;
    return 'retried';
  }), 'retried');
  assert.strictEqual(calls, 2, 'failed/completed actions may be safely retried');

  let contractCalls = 0;
  let releaseContract;
  const contractAction = () => {
    contractCalls += 1;
    return new Promise((resolve) => { releaseContract = resolve; });
  };
  const contractFirst = sandbox.withPendingAction('contract:submit:contract_one', contractAction);
  const contractSecond = sandbox.withPendingAction('contract:submit:contract_one', contractAction);
  assert.strictEqual(contractFirst, contractSecond, 'double contract submits must share one transport Promise');
  await Promise.resolve();
  assert.strictEqual(contractCalls, 1);
  releaseContract('submitted');
  await contractFirst;
});

test('browser critical mutations use stable document-specific pending-action keys', () => {
  assert.match(html, /withPendingAction\("contract:submit:"\+contract\.id/, 'contract submissions must be deduplicated');
  assert.match(html, /withPendingAction\("guide:submit:"\+guide\.id/, 'guide submissions must be deduplicated');
  assert.match(html, /withPendingAction\("client:renew:"\+client\.id/, 'renewal confirmation must be deduplicated');
  assert.match(html, /withPendingAction\("client:delete:"\+id/, 'deletes must be deduplicated');
  assert.match(html, /withPendingAction\("report:delete:"\+id/, 'report deletes must be deduplicated');
});

test('failed destructive report deletes preserve client state and surface a retryable error', async () => {
  const start = html.indexOf('  async function deleteReport(id){');
  const end = html.indexOf('\n  /* ============ REPORT VIEW', start);
  assert.ok(start >= 0 && end > start, 'deleteReport must remain independently testable');
  const pendingActions = new Map();
  const sandbox = {
    state: { reports: [{ id: 'report-one' }], currentClient: null, currentReport: { id: 'report-one' } },
    withPendingAction(key, action) {
      if (pendingActions.has(key)) return pendingActions.get(key);
      const promise = Promise.resolve().then(action).finally(() => pendingActions.delete(key));
      pendingActions.set(key, promise);
      return promise;
    },
    async delS() { return null; },
    async setP() { throw new Error('must not update index after delete failure'); },
    showToast(message) { sandbox.message = message; },
    render() { sandbox.rendered = true; },
    console: { error() {} },
  };
  vm.runInNewContext(html.slice(start, end), sandbox);
  assert.strictEqual(await sandbox.deleteReport('report-one'), false);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.state.reports)), [{ id: 'report-one' }]);
  assert.match(sandbox.message, /실패/);
  assert.strictEqual(sandbox.rendered, undefined);
});

test('server rejects malformed, oversized, and overlong public payloads before writes', async () => {
  const oversized = await invoke({
    method: 'POST', body: { operation: 'save-public-guide', guideId: 'guide_abcdefghijklmnopqrstuvwx', answers: { goal: 'x'.repeat(2_000_001) } }
  }, emptyRedis());
  assert.strictEqual(oversized.statusCode, 413);

  const malformed = await invoke({
    method: 'POST', body: { operation: 'save-public-guide', guideId: 'guide_abcdefghijklmnopqrstuvwx', answers: [] }
  }, emptyRedis());
  assert.strictEqual(malformed.statusCode, 400);

  const longSignature = await invoke({
    method: 'POST', body: {
      operation: 'submit-public-contract', contractId: 'contract_abcdefghijklmnopqrstuvwx',
      contract: { signatureDataUrl: 'data:image/png;base64,' + 'x'.repeat(1_500_001) }
    }
  }, emptyRedis());
  assert.strictEqual(longSignature.statusCode, 413);

  const rawWhitespace = await invoke({ method: 'POST', body: ' '.repeat(2_000_001) }, emptyRedis());
  assert.strictEqual(rawWhitespace.statusCode, 413, 'raw whitespace must count before JSON parsing');
  const guideResponse = response();
  await guideApi({ method: 'POST', query: { id: 'guide_abcdefghijklmnopqrstuvwx', action: 'save' }, headers: {}, body: ' '.repeat(2_000_001) }, guideResponse);
  assert.strictEqual(guideResponse.statusCode, 413, 'dedicated guide endpoint must reject raw oversized bodies before filtering');
});

test('server rejects overlarge authenticated checklist collections and ignores unexpected public fields', async () => {
  let writes = 0;
  const tooManyItems = await invoke({
    method: 'POST', headers: sessionHeaders(), body: {
      key: 'client:client_one', value: JSON.stringify({ id: 'client_one', checklist: Array.from({ length: 201 }, () => ({ text: 'item' })) })
    }
  }, async () => {
    writes += 1;
    return { ok: true, async json() { return { result: 'OK' }; }, async text() { return ''; } };
  });
  assert.strictEqual(tooManyItems.statusCode, 400);
  assert.strictEqual(writes, 0);

  const malformedGuide = await invoke({
    method: 'POST', headers: sessionHeaders(), body: { key: 'guide:guide_abcdefghijklmnopqrstuvwx', value: '{}' }
  }, emptyRedis());
  assert.strictEqual(malformedGuide.statusCode, 400, 'stored guides require their complete public shape');

  const guide = { id: 'guide_abcdefghijklmnopqrstuvwx', clientId: 'client-one', createdAt: 1, updatedAt: 1, submittedAt: null, answers: {} };
  const commands = [];
  const ignored = await invoke({
    method: 'POST', body: {
      operation: 'save-public-guide', guideId: guide.id,
      answers: { goal: 'allowed', unexpected: 'discarded' }, unexpected: { private: true }
    }
  }, async (url, options = {}) => {
    if (options.body) {
      commands.push(JSON.parse(options.body));
      return { ok: true, async json() { return { result: JSON.stringify({ status: 'ok', guide: { ...guide, updatedAt: 2, answers: { goal: 'allowed' } } }) }; }, async text() { return ''; } };
    }
    const key = decodeURIComponent(String(url).split('/get/')[1] || '');
    const result = key.includes('guide-issue:') ? JSON.stringify({ guide }) : JSON.stringify(guide);
    return { ok: true, async json() { return { result }; }, async text() { return ''; } };
  });
  assert.strictEqual(ignored.statusCode, 200);
  const evalCommand = commands.find((command) => command[0] === 'EVAL');
  assert.deepStrictEqual(JSON.parse(evalCommand[9]), { goal: 'allowed' });
});

test('a retried public contract submission returns the signed document without a second write', async () => {
  const contract = {
    id: 'contract_abcdefghijklmnopqrstuvwx', clientId: 'client-one', clientName: 'Client One',
    contractType: 'new', renewalCount: 1, createdAt: 1, updatedAt: 2, submittedAt: 2,
    signerName: 'Signed', signatureDataUrl: 'data:image/png;base64,signed'
  };
  let writes = 0;
  const res = await invoke({
    method: 'POST', body: {
      operation: 'submit-public-contract', contractId: contract.id,
      contract: { signerName: 'Signed', signatureDataUrl: 'data:image/png;base64,signed' }
    }
  }, async (url, options = {}) => {
    const command = new URL(url).pathname.split('/').filter(Boolean)[0];
    if (command === 'set') writes += 1;
    if (options.body) return { ok: true, async json() { return { result: JSON.stringify({ status: 'ok', contract }) }; }, async text() { return ''; } };
    const key = decodeURIComponent(String(url).split('/get/')[1] || '');
    const result = key === 'rs:contract:' + contract.id ? contract : [];
    return { ok: true, async json() { return { result: JSON.stringify(result) }; }, async text() { return ''; } };
  });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.contract.submittedAt, 2);
  assert.strictEqual(writes, 0, 'a safe retry must not rewrite the signed document');
});

test('concurrent contract submits and legacy partial retries commit one atomic recovery transaction', async () => {
  const contract = {
    id: 'contract_abcdefghijklmnopqrstuvwx', clientId: 'client-one', clientName: 'Client One', contractType: 'new',
    renewalCount: 1, createdAt: 1, updatedAt: 2, submittedAt: 2, signerName: 'Signed', signatureDataUrl: 'data:image/png;base64,signed'
  };
  const marker = new Map();
  let commits = 0;
  const fetchImpl = async (url, options = {}) => {
    if (options.body) {
      const command = JSON.parse(options.body);
      if (command[0] === 'EVAL') {
        const markerKey = command[8];
        if (!marker.has(markerKey)) {
          commits += 1;
          marker.set(markerKey, JSON.stringify({ status: 'ok', contract: JSON.parse(command[9]) }));
        }
        return { ok: true, async json() { return { result: marker.get(markerKey) }; }, async text() { return ''; } };
      }
    }
    const key = decodeURIComponent(String(url).split('/get/')[1] || '');
    const value = key === 'rs:contract:' + contract.id ? contract : [];
    return { ok: true, async json() { return { result: JSON.stringify(value) }; }, async text() { return ''; } };
  };
  const previousFetch = global.fetch;
  global.fetch = fetchImpl;
  try {
    const first = response();
    const second = response();
    await Promise.all([
      dataApi({ method: 'POST', query: {}, headers: {}, body: { operation: 'submit-public-contract', contractId: contract.id, contract: { signerName: 'Signed' }, idempotencyKey: 'contract-submit:contract-one' } }, first),
      dataApi({ method: 'POST', query: {}, headers: {}, body: { operation: 'submit-public-contract', contractId: contract.id, contract: { signerName: 'Signed' }, idempotencyKey: 'contract-submit:contract-one' } }, second)
    ]);
    assert.strictEqual(first.statusCode, 200);
    assert.strictEqual(second.statusCode, 200);
    assert.strictEqual(commits, 1, 'concurrent submits must share one Redis transaction marker');
  } finally {
    global.fetch = previousFetch;
  }
});

test('contract submit rejects a 201st index entry before sending an EVAL mutation', async () => {
  const contract = { id: 'contract_abcdefghijklmnopqrstuvwx', clientId: 'client-new', clientName: 'Client', contractType: 'new', renewalCount: 1, createdAt: 1, updatedAt: 1, submittedAt: null };
  const index = Array.from({ length: 200 }, (_, number) => ({ id: 'client_' + number, name: 'Client ' + number }));
  let evalCalls = 0;
  const result = await invoke({ method: 'POST', body: { operation: 'submit-public-contract', contractId: contract.id, contract: { signerName: 'Signed' }, idempotencyKey: 'contract-submit:boundary' } }, async (url, options = {}) => {
    if (options.body) evalCalls += 1;
    const key = decodeURIComponent(String(url).split('/get/')[1] || '');
    const value = key === 'rs:contract:' + contract.id ? contract : (key === 'rs:clients-index' ? index : []);
    return { ok: true, async json() { return { result: JSON.stringify(value) }; }, async text() { return ''; } };
  });
  assert.strictEqual(result.statusCode, 400);
  assert.strictEqual(evalCalls, 0);
});

test('concurrent renewal mutations share one Redis marker transaction', async () => {
  const client = { id: 'client-one', checklist: [], renewals: ['2026-09'] };
  const clientsIndex = [{ id: 'client-one', name: 'Client One' }];
  const markers = new Map();
  let commits = 0;
  const previousFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const command = JSON.parse(options.body);
    const markerKey = command[5];
    if (!markers.has(markerKey)) { commits += 1; markers.set(markerKey, JSON.stringify({ status: 'ok', client })); }
    return { ok: true, async json() { return { result: markers.get(markerKey) }; }, async text() { return ''; } };
  };
  try {
    const request = { method: 'POST', query: {}, headers: sessionHeaders(), body: { operation: 'renew-client', clientId: client.id, client, clientsIndex, idempotencyKey: 'renewal:client-one:2026-09' } };
    const first = response(); const second = response();
    await Promise.all([dataApi(request, first), dataApi(request, second)]);
    assert.strictEqual(first.statusCode, 200);
    assert.strictEqual(second.statusCode, 200);
    assert.strictEqual(commits, 1);
  } finally { global.fetch = previousFetch; }
});
