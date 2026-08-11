const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { after, test } = require('node:test');

const html = fs.readFileSync('index.html', 'utf8');
const dataApi = require('../api/data.js');
const validGuideKey = 'guide:guide_abcdefghijklmnopqrstuvwx';

const originalEnv = {
  TEAM_PASSWORD: process.env.TEAM_PASSWORD,
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN
};

process.env.TEAM_PASSWORD = 'team-secret';
process.env.KV_REST_API_URL = 'https://redis.example.test';
process.env.KV_REST_API_TOKEN = 'redis-secret';

after(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function responseDouble() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

async function requestApi(request) {
  const calls = [];
  const previousFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() { return { result: request.method === 'GET' ? '{"stored":true}' : 'OK' }; },
      async text() { return ''; }
    };
  };
  const response = responseDouble();
  try {
    await dataApi({ headers: {}, query: {}, ...request }, response);
  } finally {
    global.fetch = previousFetch;
  }
  return { response, calls };
}

test('unauthenticated GET and POST accept an exact high-entropy guide key', async () => {
  const read = await requestApi({ method: 'GET', query: { key: validGuideKey } });
  assert.strictEqual(read.response.statusCode, 200);
  assert.strictEqual(read.calls.length, 1);

  const write = await requestApi({ method: 'POST', body: { key: validGuideKey, value: '{"answers":{}}' } });
  assert.strictEqual(write.response.statusCode, 200);
  assert.strictEqual(write.calls.length, 1);
});

test('malformed, short, and bare guide keys never reach storage without authentication', async () => {
  const malformedKeys = [
    'guide:',
    'guide:guide_',
    'guide:guide_abcdefghijklmnopqrstuvw',
    'guide:guide_abcdefghijklmnopqrstuvwx.',
    'guide:guide_abcdefghijklmnopqrstuvwx/extra',
    'guide:guide_abcdefghijklmnopqrstuvw:'
  ];

  for (const key of malformedKeys) {
    const read = await requestApi({ method: 'GET', query: { key } });
    assert.strictEqual(read.response.statusCode, 401, `GET must reject ${key}`);
    assert.strictEqual(read.calls.length, 0, `GET must not access storage for ${key}`);

    const write = await requestApi({ method: 'POST', body: { key, value: '{}' } });
    assert.strictEqual(write.response.statusCode, 401, `POST must reject ${key}`);
    assert.strictEqual(write.calls.length, 0, `POST must not access storage for ${key}`);
  }
});

test('existing report reads stay public while every non-guide write stays authenticated', async () => {
  const reportRead = await requestApi({ method: 'GET', query: { key: 'report:shared-report' } });
  assert.strictEqual(reportRead.response.statusCode, 200);

  for (const request of [
    { method: 'GET', query: { key: 'client:client-1' } },
    { method: 'POST', body: { key: 'client:client-1', value: '{}' } },
    { method: 'POST', body: { key: 'report:shared-report', value: '{}' } },
    { method: 'POST', body: { key: 'guide-index', value: '{}' } },
    { method: 'DELETE', query: { key: validGuideKey } }
  ]) {
    const result = await requestApi(request);
    assert.strictEqual(result.response.statusCode, 401, `${request.method} must retain authentication`);
    assert.strictEqual(result.calls.length, 0, `${request.method} must not access storage before authentication`);
  }

  const authenticatedWrite = await requestApi({
    method: 'POST',
    headers: { 'x-team-token': 'team-secret' },
    body: { key: 'client:client-1', value: '{}' }
  });
  assert.strictEqual(authenticatedWrite.response.statusCode, 200);
  assert.strictEqual(authenticatedWrite.calls.length, 1);
});

test('newGuide creates a unique opaque guide with empty answers and review defaults', () => {
  const helperMatch = html.match(/(function newGuide[\s\S]*?\n  function guideStatus[\s\S]*?\n  })/);
  assert.ok(helperMatch, 'guide data helpers must exist together in index.html');

  let seed = 0;
  const sandbox = {
    Date: { now() { return 1700000000000; } },
    crypto: {
      getRandomValues(bytes) {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = (seed + index) % 256;
        seed += bytes.length;
        return bytes;
      }
    }
  };
  vm.runInNewContext(helperMatch[1], sandbox);

  const first = sandbox.newGuide('client-one');
  const second = sandbox.newGuide('client-one');
  assert.match(first.id, /^guide_[A-Za-z0-9_-]{24,}$/);
  assert.notStrictEqual(first.id, second.id, 'each issued guide must use a new opaque identifier');
  assert.doesNotMatch(first.id, /client-one/, 'the public identifier must not disclose the client id');
  assert.strictEqual(first.clientId, 'client-one');
  assert.strictEqual(first.createdAt, 1700000000000);
  assert.strictEqual(first.updatedAt, 1700000000000);
  assert.strictEqual(first.submittedAt, null);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(first.answers)), {
    concern: '', goal: '', priorityMenu: '', currentCustomers: '', desiredCustomers: '',
    strengths: '', story: '', contentTone: '', avoidExpressions: '', materialStatus: '',
    approverName: '', approverContact: '', operatingNotes: ''
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(first.review)), { status: 'unreviewed', memo: '' });
});

test('guideSummary returns only meaningful summary fields in stable display order', () => {
  const helperMatch = html.match(/(function newGuide[\s\S]*?\n  function guideStatus[\s\S]*?\n  })/);
  assert.ok(helperMatch, 'guide data helpers must exist together in index.html');
  const sandbox = { Date, crypto };
  vm.runInNewContext(helperMatch[1], sandbox);
  const json = (value) => JSON.parse(JSON.stringify(value));

  assert.deepStrictEqual(json(sandbox.guideSummary({
    goal: '  재방문 확대  ', priorityMenu: '', desiredCustomers: '직장인',
    strengths: '신선한 재료', story: '20년 운영', concern: 'ignored'
  })), [
    { label: '최우선 마케팅 목표', value: '재방문 확대' },
    { label: '유치하고 싶은 고객', value: '직장인' },
    { label: '매장 핵심 강점', value: '신선한 재료' },
    { label: '꼭 알리고 싶은 이야기', value: '20년 운영' }
  ]);
  assert.deepStrictEqual(json(sandbox.guideSummary({})), []);
});

test('guideFollowUps distinguishes missing answers from an explicit lack of materials', () => {
  const helperMatch = html.match(/(function newGuide[\s\S]*?\n  function guideStatus[\s\S]*?\n  })/);
  assert.ok(helperMatch, 'guide data helpers must exist together in index.html');
  const sandbox = { Date, crypto };
  vm.runInNewContext(helperMatch[1], sandbox);
  const json = (value) => JSON.parse(JSON.stringify(value));

  assert.deepStrictEqual(json(sandbox.guideFollowUps({ materialStatus: '없음' })), []);
  const followUps = sandbox.guideFollowUps({ goal: '', materialStatus: '별도 전달 예정' });
  assert.match(followUps.join(' '), /최우선 마케팅 목표/);
  assert.match(followUps.join(' '), /자료 별도 전달/);
  assert.deepStrictEqual(json(sandbox.guideFollowUps({ goal: '확정', approverContact: ' ' })), [
    '검수 및 승인 담당자 연락 수단'
  ]);
});

test('guideStatus derives not-started, draft, and submitted states from timestamps', () => {
  const helperMatch = html.match(/(function newGuide[\s\S]*?\n  function guideStatus[\s\S]*?\n  })/);
  assert.ok(helperMatch, 'guide data helpers must exist together in index.html');
  const sandbox = { Date, crypto };
  vm.runInNewContext(helperMatch[1], sandbox);

  assert.strictEqual(sandbox.guideStatus({ submittedAt: null, updatedAt: 1, createdAt: 1 }), 'not_started');
  assert.strictEqual(sandbox.guideStatus({ submittedAt: null, updatedAt: 2, createdAt: 1 }), 'draft');
  assert.strictEqual(sandbox.guideStatus({ submittedAt: 2, updatedAt: 2, createdAt: 1 }), 'submitted');
});

test('public guide route renders the mobile questionnaire and completion affordance', () => {
  assert.match(html, /params\.get\("guide"\)/);
  assert.match(html, /function renderPublicGuide\(/);
  assert.match(html, /data-guide-section/);
  assert.match(html, /id="guide-save-status"/);
  assert.match(html, /답변 수정하기/);
  assert.match(html, /별도 전달 예정/);
});

test('public questionnaire keeps all thirteen common answer fields optional across three sections', () => {
  const rendererMatch = html.match(/(function renderPublicGuide[\s\S]*?)(?=\n  async function savePublicGuide)/);
  assert.ok(rendererMatch, 'renderPublicGuide must be independently testable');
  const sandbox = {
    esc(value) { return String(value == null ? '' : value); },
    guideStatus() { return 'draft'; }
  };
  vm.runInNewContext(rendererMatch[1], sandbox);

  const markup = sandbox.renderPublicGuide({ answers: {} });
  const sections = [...markup.matchAll(/data-guide-section="\d"/g)];
  const fieldNames = [...markup.matchAll(/data-guide-field="([^"]+)"/g)].map((match) => match[1]);
  const uniqueFields = [...new Set(fieldNames)].sort();
  assert.strictEqual(sections.length, 3);
  assert.deepStrictEqual(uniqueFields, [
    'approverContact', 'approverName', 'avoidExpressions', 'concern', 'contentTone',
    'currentCustomers', 'desiredCustomers', 'goal', 'materialStatus', 'operatingNotes',
    'priorityMenu', 'story', 'strengths'
  ]);
  assert.doesNotMatch(markup, /\srequired(?:\s|=|>)/, 'blank answers must remain valid');
  assert.deepStrictEqual(
    [...markup.matchAll(/name="materialStatus"[^>]*value="([^"]+)"/g)].map((match) => match[1]),
    ['보유함', '별도 전달 예정', '없음']
  );
});

test('draft and submitted public saves update the same permanent guide document', async () => {
  const saverMatch = html.match(/(async function savePublicGuide[\s\S]*?)(?=\n  function renderGuideComplete)/);
  assert.ok(saverMatch, 'savePublicGuide must be independently testable');
  const writes = [];
  const sandbox = {
    Date: { now() { return 1700000000100 + writes.length; } },
    JSON,
    Promise,
    publicGuideSaveChain: Promise.resolve(true),
    async setS(key, value) { writes.push({ key, value: JSON.parse(JSON.stringify(value)) }); return { key }; }
  };
  vm.runInNewContext(saverMatch[1], sandbox);

  const guide = { id: 'guide_permanent', createdAt: 1700000000000, updatedAt: 1700000000000, submittedAt: null, answers: {} };
  assert.strictEqual(await sandbox.savePublicGuide(guide, false), true);
  assert.strictEqual(await sandbox.savePublicGuide(guide, true), true);
  assert.deepStrictEqual(writes.map((write) => write.key), ['guide:guide_permanent', 'guide:guide_permanent']);
  assert.strictEqual(writes[0].value.submittedAt, null);
  assert.strictEqual(writes[1].value.submittedAt, 1700000000101);
});

test('a failed submission never marks the local guide as submitted', async () => {
  const saverMatch = html.match(/(async function savePublicGuide[\s\S]*?)(?=\n  function renderGuideComplete)/);
  assert.ok(saverMatch, 'savePublicGuide must be independently testable');
  const sandbox = {
    Date: { now() { return 1700000000100; } },
    JSON,
    Promise,
    publicGuideSaveChain: Promise.resolve(true),
    async setS() { return null; }
  };
  vm.runInNewContext(saverMatch[1], sandbox);

  const guide = { id: 'guide_failed', createdAt: 1700000000000, updatedAt: 1700000000000, submittedAt: null, answers: {} };
  assert.strictEqual(await sandbox.savePublicGuide(guide, true), false);
  assert.strictEqual(guide.submittedAt, null);
});

test('input during an in-flight submit preserves submittedAt and reaches completion', async () => {
  const saverMatch = html.match(/(async function savePublicGuide[\s\S]*?)(?=\n  function renderGuideComplete)/);
  const coordinationMatch = html.match(/(function queuePublicGuideSave[\s\S]*?)(?=\n  function bindPublicGuide)/);
  assert.ok(saverMatch, 'savePublicGuide must be independently testable');
  assert.ok(coordinationMatch, 'public save coordination must be independently testable');

  const writes = [];
  let releaseSubmit;
  const submitButton = { disabled: false, textContent: '제출하기' };
  const sandbox = {
    Date: { now() { return 1700000000200; } },
    JSON,
    Promise,
    publicGuideSaveChain: Promise.resolve(true),
    publicGuideSaveTimer: null,
    publicGuideRevision: 0,
    publicGuideSubmitting: false,
    publicGuideSavePending: false,
    clearTimeout() {},
    setTimeout(callback) { callback(); return 1; },
    async setS(key, value) {
      writes.push({ key, value: JSON.parse(JSON.stringify(value)) });
      if (writes.length === 1) await new Promise((resolve) => { releaseSubmit = resolve; });
      return { key };
    },
    setGuideSaveStatus() {},
    document: {
      getElementById(id) {
        if (id === 'guide-submit') return submitButton;
        return null;
      }
    },
    app: {
      innerHTML: 'questionnaire',
      querySelectorAll() { return []; }
    },
    renderGuideComplete() { return 'completion'; },
    mountPublicGuide() {}
  };
  vm.runInNewContext(saverMatch[1], sandbox);
  vm.runInNewContext(coordinationMatch[1], sandbox);

  const guide = {
    id: 'guide_race', createdAt: 1700000000000, updatedAt: 1700000000000,
    submittedAt: null, answers: { goal: 'before submit' }
  };
  const submitting = sandbox.submitPublicGuide(guide);
  while (!releaseSubmit) await new Promise((resolve) => setImmediate(resolve));
  guide.answers.goal = 'typed during submit';
  sandbox.queuePublicGuideSave(guide);
  releaseSubmit();
  await submitting;
  await sandbox.publicGuideSaveChain;

  assert.strictEqual(writes.length, 2);
  assert.strictEqual(writes[0].value.submittedAt, 1700000000200);
  assert.strictEqual(writes[1].value.submittedAt, 1700000000200);
  assert.strictEqual(writes[1].value.answers.goal, 'typed during submit');
  assert.strictEqual(sandbox.app.innerHTML, 'completion');
});

test('completion keeps the permanent link editable without lock or reissue controls', () => {
  const completeMatch = html.match(/(function renderGuideComplete[\s\S]*?)(?=\n  function setGuideSaveStatus)/);
  assert.ok(completeMatch, 'renderGuideComplete must be independently testable');
  const sandbox = {
    esc(value) { return String(value == null ? '' : value); },
    guideSummary() { return []; },
    guideFollowUps() { return []; }
  };
  vm.runInNewContext(completeMatch[1], sandbox);

  const markup = sandbox.renderGuideComplete({ answers: {} });
  assert.match(markup, /같은 링크/);
  assert.match(markup, /답변 수정하기/);
  assert.doesNotMatch(markup, /잠금|재발급|새 링크|업로드/);
});
