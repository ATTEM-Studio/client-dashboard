// /api/moneyon.js — 머니온(카드 매출·네이버 광고 성과) 연동 프록시
//
// 필요한 환경변수:
//   MONEYON_API_URL  머니온 주소 (예: https://moneyon-zeta.vercel.app)
//   MONEYON_API_KEY  머니온 업체 관리 → 클라이언트 대시보드 연동에서 만든 연동 키 (mo_로 시작)
//
// 브라우저는 연동 키를 모른다. 팀 세션이 있는 요청만 서버가 키를 붙여 머니온에 전달한다.
//   POST {op:"status"}                                  → 연동 설정 여부
//   POST {op:"stores"}                                  → 머니온 업체 목록 (clientId로 연결 상태 확인)
//   POST {op:"link", client:{id,name,industry,businessNumber,manager,startDate}}
//   POST {op:"unlink", clientId}
//   POST {op:"summary", clientId, since, until}         → 리포트 자동 채우기 (네이버 광고 성과 + 카드 매출)

const { isAuthenticated } = require('./_session');

const TIMEOUT_MS = 25_000;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function config() {
  const url = String(process.env.MONEYON_API_URL || '').trim().replace(/\/+$/, '');
  const key = String(process.env.MONEYON_API_KEY || '').trim();
  if (!/^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?$/.test(url) && !/^http:\/\/localhost(:[0-9]+)?$/.test(url)) return null;
  if (!/^mo_[A-Za-z0-9]{40}$/.test(key)) return null;
  return { url, key };
}

function text(value, maximum) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function validDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return '';
  const d = new Date(value + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? '' : value;
}

async function callMoneyon(cfg, method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(cfg.url + path, {
      method,
      headers: Object.assign({ Authorization: 'Bearer ' + cfg.key }, body === undefined ? {} : { 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const data = await upstream.json().catch(() => ({}));
    return { status: upstream.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function relay(res, result) {
  if (result.status === 401) return res.status(502).json({ error: '머니온 연동 키가 올바르지 않거나 해제됐습니다. 머니온에서 새 키를 만들어 주세요.' });
  const error = result.data && typeof result.data.error === 'string' ? result.data.error.slice(0, 200) : '';
  if (result.status >= 400) return res.status(result.status >= 500 ? 502 : result.status).json({ error: error || '머니온 요청에 실패했습니다' });
  return res.status(200).json(result.data);
}

function publicStore(store) {
  if (!store || typeof store !== 'object') return null;
  return {
    id: text(store.id, 16), name: text(store.name, 60), clientId: text(store.clientId, 128) || null,
    naverLinked: store.naverLinked === true, url: text(store.url, 300)
  };
}

module.exports = async function (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'POST only' }); }
  if (!isAuthenticated(req)) return res.status(401).json({ error: '인증이 필요합니다' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body && typeof body === 'object' ? body : {};
  const op = text(body.op, 20);
  const cfg = config();
  if (op === 'status') return res.status(200).json({ configured: !!cfg, url: cfg ? cfg.url : null });
  if (!cfg) return res.status(503).json({ error: '머니온 연동이 설정되지 않았습니다 (MONEYON_API_URL, MONEYON_API_KEY)' });

  try {
    if (op === 'stores') {
      const result = await callMoneyon(cfg, 'GET', '/api/integration/v1/stores');
      if (result.status !== 200) return relay(res, result);
      const stores = Array.isArray(result.data.stores) ? result.data.stores.slice(0, 500).map(publicStore).filter(Boolean) : [];
      return res.status(200).json({ stores, url: cfg.url });
    }
    if (op === 'link') {
      const client = body.client && typeof body.client === 'object' ? body.client : {};
      const clientId = text(client.id, 128);
      const name = text(client.name, 30);
      if (!IDENTIFIER.test(clientId) || !name) return res.status(400).json({ error: '연결할 업체 정보가 올바르지 않습니다' });
      const result = await callMoneyon(cfg, 'POST', '/api/integration/v1/stores', {
        clientId, name,
        industry: text(client.industry, 40),
        businessNumber: text(client.businessNumber, 20),
        manager: text(client.manager, 30),
        startDate: validDate(client.startDate) || undefined
      });
      return relay(res, result);
    }
    if (op === 'unlink') {
      const clientId = text(body.clientId, 128);
      if (!IDENTIFIER.test(clientId)) return res.status(400).json({ error: '업체 정보가 올바르지 않습니다' });
      return relay(res, await callMoneyon(cfg, 'DELETE', '/api/integration/v1/stores?clientId=' + encodeURIComponent(clientId)));
    }
    if (op === 'summary') {
      const clientId = text(body.clientId, 128);
      if (!IDENTIFIER.test(clientId)) return res.status(400).json({ error: '업체 정보가 올바르지 않습니다' });
      const params = new URLSearchParams({ clientId });
      const since = validDate(body.since), until = validDate(body.until);
      if (since) params.set('since', since);
      if (until) params.set('until', until);
      return relay(res, await callMoneyon(cfg, 'GET', '/api/integration/v1/summary?' + params.toString()));
    }
    return res.status(400).json({ error: '지원하지 않는 요청입니다' });
  } catch (e) {
    return res.status(502).json({ error: e && e.name === 'AbortError' ? '머니온 응답이 늦어 중단했습니다. 잠시 뒤 다시 시도해 주세요' : '머니온에 연결하지 못했습니다' });
  }
};

