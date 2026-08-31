const assert = require('node:assert/strict');
const dataApi = require('../api/data');
const keywordApi = require('../api/naver-keyword');
const dataLabApi = require('../api/naver-datalab');
const { issueSession } = require('../api/_session');

process.env.TEAM_PASSWORD = 'review-session-password';
process.env.KV_REST_API_URL = 'https://redis.example.test';
process.env.KV_REST_API_TOKEN = 'redis-token';
process.env.NAVER_AD_API_LICENSE = 'ad-license';
process.env.NAVER_AD_API_SECRET = 'ad-secret';
process.env.NAVER_AD_CUSTOMER_ID = '12345';
process.env.NAVER_DATALAB_CLIENT_ID = 'datalab-id';
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

function sessionHeaders() {
  const res = response();
  issueSession(res);
  return { cookie: String(res.headers['set-cookie']).split(';')[0] };
}

async function invoke(handler, req, fetchImpl) {
  const previousFetch = global.fetch;
  global.fetch = fetchImpl;
  const res = response();
  try {
    await handler(req, res);
  } finally {
    global.fetch = previousFetch;
  }
  return res;
}

function redisStoreFetch(store) {
  return async (url, options = {}) => {
    if (url === process.env.KV_REST_API_URL && options.body) {
      const command = JSON.parse(options.body);
      if (command[0] === 'EVAL') {
        const keys = command.slice(3, 8);
        store.set(keys[0], command[8]);
        store.set(keys[1], command[9]);
        store.set(keys[2], command[10]);
        store.set(keys[3], command[11]);
        const result = JSON.stringify({ status: 'ok', contract: JSON.parse(command[8]) });
        store.set(keys[4], result);
        return { ok: true, async json() { return { result }; }, async text() { return ''; } };
      }
    }
    const parts = new URL(url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const command = parts[0];
    const key = parts[1];
    if (command === 'get') {
      return { ok: true, async json() { return { result: store.get(key) ?? null }; }, async text() { return ''; } };
    }
    if (command === 'set') {
      store.set(key, options.body);
      return { ok: true, async json() { return { result: 'OK' }; }, async text() { return ''; } };
    }
    throw new Error('unexpected Redis command ' + command);
  };
}

async function main() {
  const originalContract = {
    id: 'contract_abcdefghijklmnopqrstuvwx',
    clientId: 'client-one',
    clientName: 'Original Client',
    contractType: 'renewal',
    renewalCount: 3,
    productType: 'regular',
    productName: 'Original Plan',
    supplyPrice: '900000',
    paymentMethod: 'transfer',
    startDate: '2026-08-01',
    contractMonths: '6',
    fee: '990000',
    terms: 'Original terms',
    specialTerms: 'Original special terms',
    baseTerms: 'Original base terms',
    owner: 'Staff owner',
    internalMemo: 'Private note',
    businessNumber: '111-11-11111',
    contact: '010-1111-1111',
    email: 'old@example.test',
    signerName: 'Old signer',
    signatureDataUrl: '',
    createdAt: 1,
    updatedAt: 1,
    submittedAt: null
  };
  const store = new Map([['rs:contract:' + originalContract.id, JSON.stringify(originalContract)]]);
  const contractResult = await invoke(dataApi, {
    method: 'POST', headers: {}, query: {}, body: {
      operation: 'submit-public-contract', contractId: originalContract.id,
      contract: {
        clientId: 'attacker-client', clientName: 'Attacker', contractType: 'new', renewalCount: 99,
        productType: 'attacker-product', productName: 'Attacker Plan', supplyPrice: '1',
        paymentMethod: 'card', startDate: '2099-01-01', contractMonths: '99', fee: '1',
        terms: 'Attacker terms', specialTerms: 'Attacker special terms', baseTerms: 'Attacker base terms',
        owner: 'Attacker staff', internalMemo: 'Attacker memo', createdAt: -1, submittedAt: -1,
        businessNumber: '222-22-22222', contact: '010-2222-2222', email: 'customer@example.test',
        signerName: 'Customer signer', signatureDataUrl: 'data:image/png;base64,signature'
      }
    }
  }, redisStoreFetch(store));
  assert.equal(contractResult.statusCode, 200);
  const savedContract = JSON.parse(store.get('rs:contract:' + originalContract.id));
  for (const field of [
    'clientId', 'clientName', 'contractType', 'renewalCount', 'productType', 'productName', 'supplyPrice',
    'paymentMethod', 'startDate', 'contractMonths', 'fee', 'terms', 'specialTerms', 'baseTerms', 'owner',
    'internalMemo', 'createdAt'
  ]) {
    assert.equal(savedContract[field], originalContract[field], field + ' must remain server-owned');
  }
  assert.equal(savedContract.businessNumber, '222-22-22222');
  assert.equal(savedContract.contact, '010-2222-2222');
  assert.equal(savedContract.email, 'customer@example.test');
  assert.equal(savedContract.signerName, 'Customer signer');
  assert.equal(savedContract.signatureDataUrl, 'data:image/png;base64,signature');
  assert.ok(savedContract.submittedAt > 0, 'the server assigns submission time');

  for (const [name, handler, body] of [
    ['keyword', keywordApi, { keywords: ['coffee'] }],
    ['datalab', dataLabApi, { keyword: 'coffee' }]
  ]) {
    for (const status of [401, 403]) {
      const upstreamCredentialFailure = await invoke(handler, {
        method: 'POST', headers: sessionHeaders(), query: {}, body
      }, async () => ({ ok: false, status, async json() { return { error: 'upstream credentials' }; } }));
      assert.equal(upstreamCredentialFailure.statusCode, 502, name + ' upstream credentials must not look like dashboard logout');
      assert.doesNotMatch(JSON.stringify(upstreamCredentialFailure.body), /upstream credentials|401|403/i);
    }

    const methodFailure = await invoke(handler, { method: 'GET', headers: {}, query: {} }, async () => {
      throw new Error('method guard must run first');
    });
    assert.equal(methodFailure.statusCode, 405);
    assert.equal(methodFailure.headers.allow, 'POST');
  }

  const teamPassword = process.env.TEAM_PASSWORD;
  delete process.env.TEAM_PASSWORD;
  try {
    const publicRead = await invoke(dataApi, {
      method: 'GET', headers: {}, query: { key: 'report:existing-link' }
    }, redisStoreFetch(new Map([['rs:report:existing-link', '{"ok":true}']])));
    assert.equal(publicRead.statusCode, 200, 'public reads do not require dashboard configuration');

    const unsupported = await invoke(dataApi, {
      method: 'PATCH', headers: {}, query: {}
    }, async () => { throw new Error('method guard must run first'); });
    assert.equal(unsupported.statusCode, 405, 'unsupported methods do not require dashboard configuration');
  } finally {
    process.env.TEAM_PASSWORD = teamPassword;
  }

  const redisUrl = process.env.KV_REST_API_URL;
  const redisToken = process.env.KV_REST_API_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  try {
    const unavailable = await invoke(dataApi, {
      method: 'GET', headers: {}, query: { key: 'report:existing-link' }
    }, async () => { throw new Error('storage must not be called without configuration'); });
    assert.equal(unavailable.statusCode, 503);
    assert.doesNotMatch(JSON.stringify(unavailable.body), /TEAM_PASSWORD|Redis|Upstash|Vercel|환경변수/i);
  } finally {
    process.env.KV_REST_API_URL = redisUrl;
    process.env.KV_REST_API_TOKEN = redisToken;
  }

  const naverLicense = process.env.NAVER_AD_API_LICENSE;
  delete process.env.NAVER_AD_API_LICENSE;
  try {
    const unavailable = await invoke(keywordApi, {
      method: 'POST', headers: sessionHeaders(), query: {}, body: { keywords: ['coffee'] }
    }, async () => { throw new Error('upstream must not be called without credentials'); });
    assert.equal(unavailable.statusCode, 503);
    assert.doesNotMatch(JSON.stringify(unavailable.body), /NAVER|환경변수|secret|license/i);
  } finally {
    process.env.NAVER_AD_API_LICENSE = naverLicense;
  }
}

main().then(
  () => console.log('api-hardening-review.test.js: ok'),
  (error) => { console.error(error); process.exitCode = 1; }
);
