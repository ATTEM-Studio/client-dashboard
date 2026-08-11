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
