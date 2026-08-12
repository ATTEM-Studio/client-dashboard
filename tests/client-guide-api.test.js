const assert = require('assert');
const { test } = require('node:test');
const guideApi = require('../api/guide.js');
process.env.TEAM_PASSWORD = 'team-secret';
process.env.KV_REST_API_URL = 'https://redis.example.test';
process.env.KV_REST_API_TOKEN = 'redis-secret';

function response() {
  return { statusCode: null, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return this; } };
}

test('dedicated guide endpoint rejects malformed ids before storage', async () => {
  const res = response();
  await guideApi({ method: 'GET', query: { id: 'bad' }, headers: {} }, res);
  assert.strictEqual(res.statusCode, 400);
});

test('dedicated guide endpoint maps public reads to the guide data contract', async () => {
  const previous = global.fetch;
  global.fetch = async () => ({ ok: true, async json() { return { result: JSON.stringify({ id: 'guide_abcdefghijklmnopqrstuvwx', clientId: 'client-one', createdAt: 1, updatedAt: 1, submittedAt: null, answers: {} }) }; } });
  try {
    const res = response();
    await guideApi({ method: 'GET', query: { id: 'guide_abcdefghijklmnopqrstuvwx' }, headers: {} }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.key, 'guide:guide_abcdefghijklmnopqrstuvwx');
  } finally { global.fetch = previous; }
});
