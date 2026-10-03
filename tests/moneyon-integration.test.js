const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.TEAM_PASSWORD = 'moneyon-test-password';
const moneyonApi = require('../api/moneyon');
const keywordApi = require('../api/naver-keyword');
const { issueSession } = require('../api/_session');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const KEY = 'mo_' + 'A'.repeat(40);

function response() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}
function cookie() {
  const res = response();
  issueSession(res);
  return String(res.headers['set-cookie']).split(';')[0];
}
async function invoke(handler, body, options = {}) {
  const calls = [];
  const previous = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    const reply = options.reply ? options.reply(String(url), init || {}) : { status: 200, body: {} };
    return { ok: reply.status < 400, status: reply.status, async json() { return reply.body; } };
  };
  const res = response();
  try {
    await handler({ method: options.method || 'POST', headers: options.headers || { cookie: cookie() }, body }, res);
  } finally {
    global.fetch = previous;
  }
  return { res, calls };
}

async function main() {
  delete process.env.MONEYON_API_URL;
  delete process.env.MONEYON_API_KEY;

  // 세션 없는 요청은 머니온까지 가지 않는다
  let r = await invoke(moneyonApi, { op: 'stores' }, { headers: {} });
  assert.equal(r.res.statusCode, 401);
  assert.equal(r.calls.length, 0);

  // 설정 전: status는 configured=false, 나머지는 503
  r = await invoke(moneyonApi, { op: 'status' });
  assert.deepEqual(r.res.body, { configured: false, url: null });
  r = await invoke(moneyonApi, { op: 'stores' });
  assert.equal(r.res.statusCode, 503);
  assert.equal(r.calls.length, 0);

  process.env.MONEYON_API_URL = 'https://moneyon.example.test/';
  process.env.MONEYON_API_KEY = KEY;
  r = await invoke(moneyonApi, { op: 'status' });
  assert.deepEqual(r.res.body, { configured: true, url: 'https://moneyon.example.test' });
  assert.ok(!JSON.stringify(r.res.body).includes(KEY), 'the integration key must never reach the browser');

  // 업체 목록: 키는 서버에서만 Bearer로 붙고, 허용 필드만 브라우저로
  r = await invoke(moneyonApi, { op: 'stores' }, { reply: () => ({ status: 200, body: { stores: [{ id: 'u-abc12345', name: '꿈카페', clientId: 'client_1', naverLinked: true, url: 'https://moneyon.example.test/u-abc12345/dashboard', secret: 'x' }] } }) });
  assert.equal(r.calls[0].url, 'https://moneyon.example.test/api/integration/v1/stores');
  assert.equal(r.calls[0].init.headers.Authorization, 'Bearer ' + KEY);
  assert.equal(r.res.statusCode, 200);
  assert.deepEqual(Object.keys(r.res.body.stores[0]).sort(), ['clientId', 'id', 'name', 'naverLinked', 'url']);

  // 연결: 잘못된 업체 id는 막고, 올바른 요청은 필요한 필드만 전달
  r = await invoke(moneyonApi, { op: 'link', client: { id: 'bad id!', name: 'x' } });
  assert.equal(r.res.statusCode, 400);
  assert.equal(r.calls.length, 0);
  r = await invoke(moneyonApi, { op: 'link', client: { id: 'client_1', name: '꿈카페 하단지점', industry: '카페', businessNumber: '220-81-62517', startDate: '2026-09-01', memo: '내부 메모' } },
    { reply: () => ({ status: 200, body: { ok: true, storeId: 'u-abc12345', action: 'matched', url: 'https://moneyon.example.test/u-abc12345/dashboard' } }) });
  const sent = JSON.parse(r.calls[0].init.body);
  assert.equal(r.calls[0].init.method, 'POST');
  assert.deepEqual(Object.keys(sent).sort(), ['businessNumber', 'clientId', 'industry', 'manager', 'name', 'startDate']);
  assert.equal(r.res.body.action, 'matched');

  // 요약: 날짜는 검증해서만 전달
  r = await invoke(moneyonApi, { op: 'summary', clientId: 'client_1', since: '2026-09-01', until: 'not-a-date' },
    { reply: () => ({ status: 200, body: { linked: true, ads: { current: { imp: 10 }, previous: { imp: 5 } } } }) });
  assert.equal(r.calls[0].url, 'https://moneyon.example.test/api/integration/v1/summary?clientId=client_1&since=2026-09-01');
  assert.equal(r.res.body.ads.current.imp, 10);

  // 머니온이 키를 거절하면 브라우저에는 401이 아니라 502 (팀 세션 만료로 오해하지 않게)
  r = await invoke(moneyonApi, { op: 'stores' }, { reply: () => ({ status: 401, body: { error: 'invalid' } }) });
  assert.equal(r.res.statusCode, 502);

  // 키워드 도구: 머니온 연동이 있으면 머니온에 저장된 광고 키로 조회
  delete process.env.NAVER_AD_API_LICENSE;
  r = await invoke(keywordApi, { keywords: ['하단카페'] }, { reply: () => ({ status: 200, body: { keywordList: [{ relKeyword: '하단카페' }] } }) });
  assert.equal(r.calls[0].url, 'https://moneyon.example.test/api/integration/v1/naver/keywordstool');
  assert.equal(r.calls[0].init.headers.Authorization, 'Bearer ' + KEY);
  assert.equal(r.res.body.keywordList[0].relKeyword, '하단카페');

  // 화면: 데모에서는 머니온을 부르지 않는다
  assert.match(html, /function moneyonCall\(payload\)\{\s*if\(isDemoMode\(\)\) throw/);
  assert.match(html, /function moneyonImportHtml\(base\)\{\s*if\(isDemoMode\(\)\) return ""/);
  assert.match(html, /function moneyonClientActionHtml\(cl\)\{\s*if\(isDemoMode\(\)\) return ""/);
  assert.ok(html.includes('"/api/moneyon"'), 'the dashboard must reach Moneyon only through its own API');
  assert.ok(!/MONEYON_API_KEY/.test(html), 'the browser bundle must not reference the integration key');
  assert.ok(html.includes('params.get("client")'), 'Moneyon deep links (?client=) must open the client');

  console.log('moneyon integration: ok');
}

main().catch((error) => { console.error(error); process.exit(1); });
