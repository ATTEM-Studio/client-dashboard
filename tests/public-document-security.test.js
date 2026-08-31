const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const dataApi = require('../api/data');
const { issueSession } = require('../api/_session');
const html = fs.readFileSync('index.html', 'utf8');

function response() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; },
  };
}

function redisFetch(values) {
  return async (url) => {
    const key = decodeURIComponent(String(url).split('/get/')[1] || '');
    return { ok: true, async json() { return { result: values.get(key) ?? null }; } };
  };
}

async function publicRead(key, values) {
  const previousFetch = global.fetch;
  const previousUrl = process.env.KV_REST_API_URL;
  const previousToken = process.env.KV_REST_API_TOKEN;
  process.env.KV_REST_API_URL = 'https://redis.example.test';
  process.env.KV_REST_API_TOKEN = 'test-token';
  global.fetch = redisFetch(values);
  try {
    const res = response();
    await dataApi({ method: 'GET', query: { key }, headers: {} }, res);
    return res;
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = previousToken;
  }
}

function signedSessionCookie() {
  const res = response();
  issueSession(res);
  return String(res.headers['set-cookie']).split(';')[0];
}

async function staffRead(key, values) {
  const previousFetch = global.fetch;
  const previousUrl = process.env.KV_REST_API_URL;
  const previousToken = process.env.KV_REST_API_TOKEN;
  const previousPassword = process.env.TEAM_PASSWORD;
  process.env.KV_REST_API_URL = 'https://redis.example.test';
  process.env.KV_REST_API_TOKEN = 'test-token';
  process.env.TEAM_PASSWORD = 'private-field-test-password';
  global.fetch = redisFetch(values);
  try {
    const res = response();
    await dataApi({ method: 'GET', query: { key }, headers: { cookie: signedSessionCookie() } }, res);
    return res;
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = previousToken;
    if (previousPassword === undefined) delete process.env.TEAM_PASSWORD;
    else process.env.TEAM_PASSWORD = previousPassword;
  }
}

test('new report IDs are opaque 24-byte hexadecimal values', () => {
  // Removing crypto-backed ID generation must make this test fail.
  const match = html.match(/(function publicId\(prefix\)\{[\s\S]*?\n  \})/);
  assert.ok(match, 'publicId helper must exist in index.html');
  const sandbox = { crypto: crypto.webcrypto, Array };
  vm.runInNewContext(match[1], sandbox);
  const ids = new Set(Array.from({ length: 1000 }, () => sandbox.publicId('rpt')));
  assert.equal(ids.size, 1000);
  for (const id of ids) assert.match(id, /^rpt_[A-Fa-f0-9]{48}$/);
});

test('public reports return only report-view fields and recursively safe values', async () => {
  // Returning the stored report directly must make this test fail.
  const id = 'rpt_0123456789abcdef0123456789abcdef0123456789abcdef';
  const stored = {
    id, type: 'weekly', client: 'Acme', clientId: 'cl_internal', period: '2026년 8월 1주차', goal: 'More calls',
    channels: [{ name: 'Search', metrics: [{ label: 'Clicks', value: '120', hidden: 'nope', nested: { token: 'nope' } }], owner: 'nope' }],
    tests: ['headline'], results: ['120 clicks'], next_week: ['review'], deliveryMemo: 'Visible note',
    revenue: { weekly: 1200000, internalMemo: 'nope', nested: { secret: 'nope' } },
    internalMemo: 'secret', owner: 'operator', unexpected: { secret: 'secret' },
  };
  const res = await publicRead(`report:${id}`, new Map([[`rs:report:${id}`, JSON.stringify(stored)]]));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body.value), {
    id, type: 'weekly', client: 'Acme', clientId: 'cl_internal', period: '2026년 8월 1주차', goal: 'More calls',
    channels: [{ name: 'Search', metrics: [{ label: 'Clicks', value: '120' }] }],
    tests: ['headline'], results: ['120 clicks'], next_week: ['review'], deliveryMemo: 'Visible note',
    revenue: { weekly: 1200000 },
  });
});

test('legacy report links remain publicly readable', async () => {
  const id = 'rpt_mf9ad2xk3z';
  const res = await publicRead(`report:${id}`, new Map([[`rs:report:${id}`, JSON.stringify({ id, type: 'monthly', client: 'Acme', period: '2026년 8월' })]]));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body.value), { id, type: 'monthly', client: 'Acme', period: '2026년 8월' });
});

test('public guide and contract responses do not pass nested or unexpected values through', async () => {
  // Weakening guide or contract response allowlists must make this test fail.
  const guideId = 'guide_0123456789abcdef01234567';
  const guide = {
    id: guideId, clientId: 'cl_one', createdAt: 1, updatedAt: 2, submittedAt: null,
    answers: { concern: 'More calls', goal: { internalMemo: 'secret' }, unexpected: 'secret' },
    internalMemo: 'secret', owner: 'operator', unexpected: { secret: 'secret' },
  };
  const guideRes = await publicRead(`guide:${guideId}`, new Map([[`rs:guide:${guideId}`, JSON.stringify(guide)]]));
  assert.equal(guideRes.statusCode, 200);
  assert.deepEqual(JSON.parse(guideRes.body.value), {
    id: guideId, clientId: 'cl_one', createdAt: 1, updatedAt: 2, submittedAt: null,
    answers: { concern: 'More calls' },
  });

  const contractId = 'contract_0123456789abcdef01234567';
  const contract = {
    id: contractId, clientId: 'cl_one', clientName: 'Acme', contractType: 'new', renewalCount: 1,
    terms: { internalMemo: 'secret' }, createdAt: 1, updatedAt: 2,
    internalMemo: 'secret', owner: 'operator', unexpected: { secret: 'secret' },
  };
  const contractRes = await publicRead(`contract:${contractId}`, new Map([[`rs:contract:${contractId}`, JSON.stringify(contract)]]));
  assert.equal(contractRes.statusCode, 200);
  const publicContract = JSON.parse(contractRes.body.value);
  assert.equal(publicContract.terms, undefined);
  assert.equal(publicContract.internalMemo, undefined);
  assert.equal(publicContract.owner, undefined);
  assert.equal(publicContract.unexpected, undefined);
});

test('signed staff reads retain private report, guide, and contract fields while public reads redact them', async () => {
  // Unconditionally applying the public serializers must make the signed-read assertions fail.
  const reportId = 'rpt_0123456789abcdef0123456789abcdef0123456789abcdef';
  const guideId = 'guide_0123456789abcdef01234567';
  const contractId = 'contract_0123456789abcdef01234567';
  const documents = [
    {
      key: `report:${reportId}`,
      privateField: 'internalMemo',
      document: { id: reportId, type: 'weekly', client: 'Acme', internalMemo: 'staff report note' },
    },
    {
      key: `guide:${guideId}`,
      privateField: 'internalReview',
      document: {
        id: guideId, clientId: 'cl_one', createdAt: 1, updatedAt: 2, submittedAt: null,
        answers: { concern: 'More calls' }, internalReview: 'staff guide note',
      },
    },
    {
      key: `contract:${contractId}`,
      privateField: 'internalMemo',
      document: {
        id: contractId, clientId: 'cl_one', clientName: 'Acme', contractType: 'new', renewalCount: 1,
        createdAt: 1, updatedAt: 2, internalMemo: 'staff contract note',
      },
    },
  ];
  const values = new Map(documents.map(({ key, document }) => [`rs:${key}`, JSON.stringify(document)]));

  for (const { key, privateField, document } of documents) {
    const staff = await staffRead(key, values);
    assert.equal(staff.statusCode, 200, `signed session reads ${key}`);
    assert.deepEqual(JSON.parse(staff.body.value), document, `signed session retains ${key} private fields`);

    const publicRes = await publicRead(key, values);
    assert.equal(publicRes.statusCode, 200, `public reads ${key}`);
    assert.equal(JSON.parse(publicRes.body.value)[privateField], undefined, `public ${key} omits ${privateField}`);
  }
});
