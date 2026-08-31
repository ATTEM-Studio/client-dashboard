const assert = require('node:assert/strict');
const dataApi = require('../api/data');
const keywordApi = require('../api/naver-keyword');
const dataLabApi = require('../api/naver-datalab');
const { issueSession } = require('../api/_session');

process.env.TEAM_PASSWORD = 'session-test-password';
process.env.KV_REST_API_URL = 'https://redis.example.test';
process.env.KV_REST_API_TOKEN = 'redis-test-token';
process.env.NAVER_AD_API_LICENSE = 'naver-license';
process.env.NAVER_AD_API_SECRET = 'naver-secret';
process.env.NAVER_AD_CUSTOMER_ID = '123456';
process.env.NAVER_DATALAB_CLIENT_ID = 'datalab-client';
process.env.NAVER_DATALAB_CLIENT_SECRET = 'datalab-secret';

function response() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function sessionCookie() {
  const res = response();
  issueSession(res);
  return String(res.headers['set-cookie']).split(';')[0];
}

function request(method, options = {}) {
  return {
    method,
    headers: options.headers || {},
    query: options.query || {},
    body: options.body
  };
}

async function invoke(handler, req, fetchResponse) {
  const previousFetch = global.fetch;
  let calls = 0;
  global.fetch = async (...args) => {
    calls += 1;
    if (typeof fetchResponse === 'function') return fetchResponse(...args);
    return fetchResponse || {
      ok: true,
      status: 200,
      async json() { return { result: '{"stored":true}' }; },
      async text() { return ''; }
    };
  };
  const res = response();
  try {
    await handler(req, res);
  } finally {
    global.fetch = previousFetch;
  }
  return { res, calls };
}

async function main() {
  const cookie = sessionCookie();
  const legacyHeaders = [
    { 'x-team-token': process.env.TEAM_PASSWORD },
    { authorization: 'Bearer ' + process.env.TEAM_PASSWORD }
  ];

  for (const headers of [{}, ...legacyHeaders]) {
    const result = await invoke(dataApi, request('GET', { headers, query: { key: 'client:one' } }));
    assert.equal(result.res.statusCode, 401, 'staff data reads require a session cookie');
    assert.equal(result.calls, 0, 'unauthenticated staff reads do not reach Redis');
  }

  for (const [method, options] of [
    ['POST', { body: { key: 'client:one', value: '{}' } }],
    ['DELETE', { query: { key: 'client:one' } }],
    ['POST', { body: { operation: 'reserve-guide-issue', clientId: 'one' } }]
  ]) {
    for (const headers of [{}, ...legacyHeaders]) {
      const result = await invoke(dataApi, request(method, { ...options, headers }));
      assert.equal(result.res.statusCode, 401, method + ' staff data operation rejects missing and legacy credentials');
      assert.equal(result.calls, 0, 'unauthenticated staff writes do not reach Redis');
    }
  }

  const staffRead = await invoke(dataApi, request('GET', {
    headers: { cookie }, query: { key: 'client:one' }
  }));
  assert.equal(staffRead.res.statusCode, 200);
  assert.equal(staffRead.calls, 1);

  const staffWrite = await invoke(dataApi, request('POST', {
    headers: { cookie }, body: { key: 'client:one', value: '{"id":"one","checklist":[]}' }
  }));
  assert.equal(staffWrite.res.statusCode, 200);
  assert.equal(staffWrite.calls, 1);

  const staffDelete = await invoke(dataApi, request('DELETE', {
    headers: { cookie }, query: { key: 'client:one' }
  }));
  assert.equal(staffDelete.res.statusCode, 400, 'client deletion must use the atomic mutation endpoint');
  assert.equal(staffDelete.calls, 0);

  const guideIssue = await invoke(dataApi, request('POST', {
    headers: { cookie }, body: { operation: 'reserve-guide-issue', clientId: 'one' }
  }), async (url, options = {}) => {
    if (url === process.env.KV_REST_API_URL && options.method === 'POST') {
      return { ok: true, async json() { return { result: 'OK' }; }, async text() { return ''; } };
    }
    return {
      ok: true,
      async json() { return { result: JSON.stringify({ id: 'one' }) }; },
      async text() { return ''; }
    };
  });
  assert.equal(guideIssue.res.statusCode, 200, 'a valid session cookie authorizes protected guide issuance');
  assert.equal(guideIssue.calls, 3);

  const publicGuide = await invoke(dataApi, request('GET', {
    query: { key: 'guide:guide_abcdefghijklmnopqrstuvwx' }
  }), {
    ok: true,
    status: 200,
    async json() {
      return { result: JSON.stringify({
        id: 'guide_abcdefghijklmnopqrstuvwx', clientId: 'client-one',
        createdAt: 1, updatedAt: 1, submittedAt: null, answers: {}
      }) };
    },
    async text() { return ''; }
  });
  assert.equal(publicGuide.res.statusCode, 200, 'public guide reads remain unauthenticated');

  const publicContract = await invoke(dataApi, request('GET', {
    query: { key: 'contract:contract_abcdefghijklmnopqrstuvwx' }
  }), {
    ok: true,
    status: 200,
    async json() {
      return { result: JSON.stringify({ id: 'contract_abcdefghijklmnopqrstuvwx', clientId: 'client-one' }) };
    },
    async text() { return ''; }
  });
  assert.equal(publicContract.res.statusCode, 200, 'public contract reads remain unauthenticated');

  const publicReport = await invoke(dataApi, request('GET', {
    query: { key: 'report:existing-share-link' }
  }));
  assert.equal(publicReport.res.statusCode, 200, 'public report reads remain unauthenticated');

  for (const [name, handler, body] of [
    ['keyword', keywordApi, { keywords: ['coffee'] }],
    ['datalab', dataLabApi, { keyword: 'coffee' }]
  ]) {
    for (const headers of [{}, ...legacyHeaders]) {
      const result = await invoke(handler, request('POST', { headers, body }));
      assert.equal(result.res.statusCode, 401, name + ' requests reject missing and legacy credentials');
      assert.equal(result.calls, 0, name + ' requests do not call Naver before session authentication');
    }

    const result = await invoke(handler, request('POST', { headers: { cookie }, body }), {
      ok: true,
      status: 200,
      async json() { return { ok: true }; }
    });
    assert.equal(result.res.statusCode, 200, name + ' accepts a valid session cookie');
    assert.equal(result.calls, 1);
  }
}

main().then(
  () => console.log('protected-api-session.test.js: ok'),
  (error) => { console.error(error); process.exitCode = 1; }
);
