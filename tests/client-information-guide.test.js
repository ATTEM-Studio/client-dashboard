const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { after, test } = require('node:test');

const html = fs.readFileSync('index.html', 'utf8');
assert.match(html, /localStorage\.setItem\("guide-draft:/, 'guide drafts should survive reopening after a failed save');
assert.match(html, /localStorage\.getItem\("guide-draft:/, 'guide should restore a newer local draft');
const dataApi = require('../api/data.js');
const validGuideKey = 'guide:guide_abcdefghijklmnopqrstuvwx';
const validReviewKey = 'guide-review:guide_abcdefghijklmnopqrstuvwx';

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
      async json() {
        return {
          result: Object.prototype.hasOwnProperty.call(request, 'storageResult')
            ? request.storageResult
            : (request.method === 'GET' ? '{"stored":true}' : 'OK')
        };
      },
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

test('unauthenticated GET accepts an exact high-entropy guide key but generic POST cannot create it', async () => {
  const read = await requestApi({
    method: 'GET', query: { key: validGuideKey },
    storageResult: JSON.stringify({
      id: 'guide_abcdefghijklmnopqrstuvwx', clientId: 'client-one',
      createdAt: 100, updatedAt: 100, submittedAt: null, answers: {}
    })
  });
  assert.strictEqual(read.response.statusCode, 200);
  assert.strictEqual(read.calls.length, 1);

  const write = await requestApi({ method: 'POST', body: { key: validGuideKey, value: '{"answers":{}}' } });
  assert.strictEqual(write.response.statusCode, 401);
  assert.strictEqual(write.calls.length, 0);
});

test('guide GET treats Redis JSON empty answer arrays as empty answer objects', async () => {
  const read = await requestApi({
    method: 'GET', query: { key: validGuideKey },
    storageResult: JSON.stringify({
      id: 'guide_abcdefghijklmnopqrstuvwx', clientId: 'client-one',
      createdAt: 100, updatedAt: 100, submittedAt: null, answers: []
    })
  });

  assert.strictEqual(read.response.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(read.response.body.value).answers, {});
});

test('public guide API strips internal review data from reads', async () => {
  const publicDocument = {
    id: 'guide_abcdefghijklmnopqrstuvwx', clientId: 'client-one',
    createdAt: 100, updatedAt: 100, submittedAt: null,
    answers: { goal: '공개 목표' },
    review: { status: 'reviewed', memo: '외부에 노출되면 안 되는 메모' }
  };
  const read = await requestApi({
    method: 'GET', query: { key: validGuideKey }, storageResult: JSON.stringify(publicDocument)
  });
  assert.strictEqual(read.response.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(read.response.body.value), {
    id: 'guide_abcdefghijklmnopqrstuvwx', clientId: 'client-one',
    createdAt: 100, updatedAt: 100, submittedAt: null,
    answers: { goal: '공개 목표' }
  });
});

test('invalid stored public guide data is a retryable server error rather than a missing guide', async () => {
  const result = await requestApi({
    method: 'GET', query: { key: validGuideKey },
    storageResult: JSON.stringify({
      id: 'guide_differentabcdefghijklmnopqrstuvwx',
      clientId: 'client-one', createdAt: 100, updatedAt: 100, submittedAt: null, answers: {}
    })
  });
  assert.strictEqual(result.response.statusCode, 500);
});

test('public draft operation rejects a valid but nonexistent guide instead of creating it', async () => {
  const result = await requestApi({
    method: 'POST',
    body: {
      operation: 'save-public-guide',
      guideId: 'guide_abcdefghijklmnopqrstuvwx',
      answers: { goal: 'new goal' }
    },
    storageResult: null
  });

  assert.strictEqual(result.response.statusCode, 404);
  assert.strictEqual(result.calls.length, 1, 'the server must only check the existing record');
  assert.match(result.calls[0].url, /\/get\/rs%3Aguide%3Aguide_abcdefghijklmnopqrstuvwx$/);
});

test('public draft operation repairs an existing guide that is missing its issuance reservation', async () => {
  const stored = {
    id: 'guide_abcdefghijklmnopqrstuvwx', clientId: 'client-not-issued',
    createdAt: 100, updatedAt: 100, submittedAt: null, answers: {}
  };
  const calls = [];
  const previousFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.body) {
      const command = JSON.parse(options.body);
      if (command[0] === 'SET' && command[1] === 'rs:guide-issue:client-not-issued') {
        return { ok: true, async json() { return { result: 'OK' }; }, async text() { return ''; } };
      }
      if (command[0] === 'EVAL') {
        return { ok: true, async json() { return { result: JSON.stringify({
          status: 'ok',
          guide: Object.assign({}, stored, { updatedAt: 200, answers: { goal: 'fixed' } })
        }) }; }, async text() { return ''; } };
      }
    }
    return {
      ok: true,
      async json() { return { result: calls.length === 1 ? JSON.stringify(stored) : null }; },
      async text() { return ''; }
    };
  };
  const response = responseDouble();
  try {
    await dataApi({ method: 'POST', headers: {}, query: {}, body: {
      operation: 'save-public-guide', guideId: stored.id, answers: { goal: 'fixed' }
    } }, response);
  } finally {
    global.fetch = previousFetch;
  }

  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.body.guide.answers.goal, 'fixed');
  assert.ok(calls.some((call) => call.options && call.options.body && call.options.body.includes('guide-issue:client-not-issued')), 'missing reservation should be recreated for the existing guide');
  assert.match(calls[1].url, /\/get\/rs%3Aguide-issue%3Aclient-not-issued$/);
});

test('public draft operation merges only whitelisted answers into the existing server document', async () => {
  const stored = {
    id: 'guide_abcdefghijklmnopqrstuvwx',
    clientId: 'client-issued',
    createdAt: 100,
    updatedAt: 150,
    submittedAt: null,
    serviceContext: 'SNS 운영',
    answers: { concern: 'keep me', goal: 'old goal' },
    review: { status: 'reviewed', memo: 'legacy private memo' }
  };
  const calls = [];
  const previousFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return { ok: true, async json() { return { result: JSON.stringify(stored) }; }, async text() { return ''; } };
    }
    if (calls.length === 2) {
      return {
        ok: true,
        async json() { return { result: JSON.stringify({ guide: stored }) }; },
        async text() { return ''; }
      };
    }
    const command = JSON.parse(options.body);
    assert.strictEqual(command[0], 'EVAL');
    assert.strictEqual(command[2], 2);
    assert.deepStrictEqual(command.slice(3, 9), [
      'rs:guide:guide_abcdefghijklmnopqrstuvwx',
      'rs:guide-issue:client-issued',
      'guide_abcdefghijklmnopqrstuvwx',
      'client-issued',
      '0',
      JSON.stringify({ concern: 'changed', goal: 'new goal', review: 'secret', unknown: 'drop me' })
    ]);
    const guide = {
      id: stored.id, clientId: stored.clientId, createdAt: stored.createdAt,
      updatedAt: 200, submittedAt: null, serviceContext: 'SNS 운영',
      answers: { concern: 'changed', goal: 'new goal' }
    };
    return {
      ok: true,
      async json() { return { result: JSON.stringify({ status: 'ok', guide }) }; },
      async text() { return ''; }
    };
  };
  const response = responseDouble();
  try {
    await dataApi({
      method: 'POST', headers: {}, query: {}, body: {
        operation: 'save-public-guide',
        guideId: stored.id,
        id: 'guide_attacker_controlled_1234567890',
        clientId: 'client-attacker',
        createdAt: -1,
        updatedAt: -1,
        submittedAt: -1,
        serviceContext: 'replaced',
        answers: { concern: 'changed', goal: 'new goal', review: 'secret', unknown: 'drop me' }
      }
    }, response);
  } finally {
    global.fetch = previousFetch;
  }

  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(calls.length, 3);
  const saved = response.body.guide;
  assert.strictEqual(saved.id, stored.id);
  assert.strictEqual(saved.clientId, 'client-issued');
  assert.strictEqual(saved.createdAt, 100);
  assert.ok(saved.updatedAt > 150);
  assert.strictEqual(saved.submittedAt, null);
  assert.strictEqual(saved.serviceContext, 'SNS 운영');
  assert.deepStrictEqual(saved.answers, { concern: 'changed', goal: 'new goal' });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(saved, 'review'), false);
  assert.deepStrictEqual(response.body.guide, saved);
});

test('public guide mutation accepts Redis JSON empty answer objects as guide objects', async () => {
  const stored = {
    id: 'guide_abcdefghijklmnopqrstuvwx',
    clientId: 'client-issued',
    createdAt: 100,
    updatedAt: 150,
    submittedAt: null,
    answers: {}
  };
  const previousFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path.includes('/get/rs%3Aguide%3A')) {
      return { ok: true, async json() { return { result: JSON.stringify(stored) }; }, async text() { return ''; } };
    }
    if (path.includes('/get/rs%3Aguide-issue%3A')) {
      return {
        ok: true,
        async json() { return { result: JSON.stringify({ guide: stored }) }; },
        async text() { return ''; }
      };
    }
    const command = JSON.parse(options.body);
    assert.strictEqual(command[0], 'EVAL');
    return {
      ok: true,
      async json() {
        return {
          result: JSON.stringify({
            status: 'ok',
            guide: {
              id: stored.id,
              clientId: stored.clientId,
              createdAt: stored.createdAt,
              updatedAt: 200,
              submittedAt: null,
              answers: []
            }
          })
        };
      },
      async text() { return ''; }
    };
  };
  const response = responseDouble();
  try {
    await dataApi({ method: 'POST', headers: {}, query: {}, body: {
      operation: 'save-public-guide', guideId: stored.id, answers: {}
    } }, response);
  } finally {
    global.fetch = previousFetch;
  }

  assert.strictEqual(response.statusCode, 200);
  assert.deepStrictEqual(response.body.guide.answers, {});
});

test('public submit operation assigns submittedAt server-side and later drafts preserve it', async () => {
  const original = {
    id: 'guide_abcdefghijklmnopqrstuvwx', clientId: 'client-issued',
    createdAt: 100, updatedAt: 150, submittedAt: null, answers: { goal: 'old' }
  };
  let stored = JSON.stringify(original);
  let serverNow = 1700000000000;
  const previousFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path.includes('/get/rs%3Aguide%3A')) {
      return { ok: true, async json() { return { result: stored }; }, async text() { return ''; } };
    }
    if (path.includes('/get/rs%3Aguide-issue%3A')) {
      return {
        ok: true,
        async json() { return { result: JSON.stringify({ guide: original }) }; },
        async text() { return ''; }
      };
    }
    const command = JSON.parse(options.body);
    assert.strictEqual(command[0], 'EVAL');
    const guide = JSON.parse(stored);
    const requestedAnswers = JSON.parse(command[8]);
    serverNow += 10;
    guide.updatedAt = serverNow;
    if (command[7] === '1' && guide.submittedAt === null) guide.submittedAt = serverNow;
    guide.answers = { ...guide.answers, ...requestedAnswers };
    stored = JSON.stringify(guide);
    return {
      ok: true,
      async json() { return { result: JSON.stringify({ status: 'ok', guide }) }; },
      async text() { return ''; }
    };
  };
  try {
    const submitResponse = responseDouble();
    await dataApi({ method: 'POST', headers: {}, query: {}, body: {
      operation: 'submit-public-guide', guideId: original.id,
      submittedAt: 1, answers: { goal: 'submitted' }
    } }, submitResponse);
    const submitted = JSON.parse(stored);
    assert.strictEqual(submitResponse.statusCode, 200);
    assert.strictEqual(submitted.submittedAt, submitted.updatedAt);
    assert.notStrictEqual(submitted.submittedAt, 1);

    const submittedAt = submitted.submittedAt;
    const draftResponse = responseDouble();
    await dataApi({ method: 'POST', headers: {}, query: {}, body: {
      operation: 'save-public-guide', guideId: original.id,
      submittedAt: null, answers: { goal: 'edited later' }
    } }, draftResponse);
    assert.strictEqual(draftResponse.statusCode, 200);
    assert.strictEqual(JSON.parse(stored).submittedAt, submittedAt);
  } finally {
    global.fetch = previousFetch;
  }
});

test('a paused stale draft cannot undo a public guide submission that completes first', async () => {
  const guideId = 'guide_abcdefghijklmnopqrstuvwx';
  const guideKey = `rs:guide:${guideId}`;
  const issueKey = 'rs:guide-issue:client-issued';
  const original = {
    id: guideId, clientId: 'client-issued', createdAt: 100,
    updatedAt: 100, submittedAt: null, answers: { concern: 'original', goal: 'original' }
  };
  const redisStore = new Map([
    [guideKey, JSON.stringify(original)],
    [issueKey, JSON.stringify({ guide: original })]
  ]);
  const answerFields = [
    'concern', 'goal', 'priorityMenu', 'currentCustomers', 'desiredCustomers', 'strengths',
    'story', 'contentTone', 'avoidExpressions', 'materialStatus', 'approverName',
    'approverContact', 'operatingNotes'
  ];
  const evalCommands = [];
  let redisMillis = 1700000000000;
  let issueReads = 0;
  let releaseStaleIssueRead;
  let staleIssueReadReached;
  const staleIssueRead = new Promise((resolve) => { staleIssueReadReached = resolve; });
  const previousFetch = global.fetch;

  global.fetch = async (url, options = {}) => {
    if (url === 'https://redis.example.test' && options.method === 'POST') {
      const command = JSON.parse(options.body);
      if (command[0] === 'EVAL') {
        evalCommands.push(command);
        assert.strictEqual(command[2], 2);
        const atomicGuideKey = command[3];
        const atomicIssueKey = command[4];
        const requestedGuideId = command[5];
        const requestedClientId = command[6];
        const submitted = command[7] === '1';
        const requestedAnswers = JSON.parse(command[8]);
        const guide = JSON.parse(redisStore.get(atomicGuideKey));
        const reservation = JSON.parse(redisStore.get(atomicIssueKey));
        assert.strictEqual(guide.id, requestedGuideId);
        assert.strictEqual(guide.clientId, requestedClientId);
        assert.strictEqual(reservation.guide.id, requestedGuideId);

        const mergedAnswers = {};
        for (const field of answerFields) {
          if (typeof guide.answers[field] === 'string') mergedAnswers[field] = guide.answers[field];
          if (typeof requestedAnswers[field] === 'string') mergedAnswers[field] = requestedAnswers[field];
        }
        redisMillis += 10;
        guide.answers = mergedAnswers;
        guide.updatedAt = redisMillis;
        if (submitted && guide.submittedAt === null) guide.submittedAt = redisMillis;
        redisStore.set(atomicGuideKey, JSON.stringify(guide));
        return {
          ok: true,
          async json() { return { result: JSON.stringify({ status: 'ok', guide }) }; },
          async text() { return ''; }
        };
      }
      if (command[0] === 'SET') {
        redisStore.set(command[1], command[2]);
        return { ok: true, async json() { return { result: 'OK' }; }, async text() { return ''; } };
      }
      throw new Error(`unexpected Redis command ${command[0]}`);
    }

    const path = new URL(url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (path[0] === 'set') {
      redisStore.set(path[1], options.body);
      return { ok: true, async json() { return { result: 'OK' }; }, async text() { return ''; } };
    }
    assert.strictEqual(path[0], 'get');
    const storedValue = redisStore.get(path[1]) ?? null;
    if (path[1] === issueKey && ++issueReads === 1) {
      staleIssueReadReached();
      await new Promise((resolve) => { releaseStaleIssueRead = resolve; });
    }
    return { ok: true, async json() { return { result: storedValue }; }, async text() { return ''; } };
  };

  const staleResponse = responseDouble();
  const submitResponse = responseDouble();
  try {
    const staleDraft = dataApi({ method: 'POST', headers: {}, query: {}, body: {
      operation: 'save-public-guide', guideId,
      answers: { concern: 'stale draft', unknown: 'must not persist' }
    } }, staleResponse);
    await staleIssueRead;

    await dataApi({ method: 'POST', headers: {}, query: {}, body: {
      operation: 'submit-public-guide', guideId, answers: { goal: 'submitted answer' }
    } }, submitResponse);
    assert.strictEqual(submitResponse.statusCode, 200);
    const submittedAt = JSON.parse(redisStore.get(guideKey)).submittedAt;
    assert.ok(Number.isFinite(submittedAt), 'the interleaved submit must commit before the stale draft resumes');

    releaseStaleIssueRead();
    await staleDraft;
    assert.strictEqual(staleResponse.statusCode, 200);

    const finalGuide = JSON.parse(redisStore.get(guideKey));
    assert.strictEqual(finalGuide.submittedAt, submittedAt);
    assert.ok(finalGuide.updatedAt >= finalGuide.submittedAt);
    assert.deepStrictEqual(finalGuide.answers, { concern: 'stale draft', goal: 'submitted answer' });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(finalGuide.answers, 'unknown'), false);
    assert.strictEqual(evalCommands.length, 2, 'both mutations must merge inside Redis');
  } finally {
    if (releaseStaleIssueRead) releaseStaleIssueRead();
    global.fetch = previousFetch;
  }
});

test('internal guide review keys require authentication for reads and writes', async () => {
  for (const request of [
    { method: 'GET', query: { key: validReviewKey } },
    { method: 'POST', body: { key: validReviewKey, value: '{"status":"reviewed","memo":"secret"}' } }
  ]) {
    const result = await requestApi(request);
    assert.strictEqual(result.response.statusCode, 401);
    assert.strictEqual(result.calls.length, 0);
  }

  const authenticatedRead = await requestApi({
    method: 'GET', headers: { 'x-team-token': 'team-secret' }, query: { key: validReviewKey }
  });
  assert.strictEqual(authenticatedRead.response.statusCode, 200);
  const authenticatedWrite = await requestApi({
    method: 'POST', headers: { 'x-team-token': 'team-secret' },
    body: { key: validReviewKey, value: '{"status":"reviewed","memo":"secret"}' }
  });
  assert.strictEqual(authenticatedWrite.response.statusCode, 200);
});

test('authenticated guide issuance reservation atomically returns one stored guide to concurrent callers', async () => {
  const redisStore = new Map([
    ['rs:client:client-one', JSON.stringify({ id: 'client-one' })]
  ]);
  const previousFetch = global.fetch;
  let setNxCalls = 0;
  global.fetch = async (url, options = {}) => {
    if (url === 'https://redis.example.test' && options.method === 'POST') {
      const command = JSON.parse(options.body);
      assert.strictEqual(command[0], 'SET');
      assert.strictEqual(command[3], 'NX');
      if (command[1] === 'rs:guide-issue:client-one') {
        setNxCalls += 1;
        await new Promise((resolve) => setImmediate(resolve));
      } else {
        assert.match(command[1], /^rs:guide:guide_[A-Za-z0-9_-]{24,}$/);
      }
      if (redisStore.has(command[1])) {
        return { ok: true, async json() { return { result: null }; }, async text() { return ''; } };
      }
      redisStore.set(command[1], command[2]);
      return { ok: true, async json() { return { result: 'OK' }; }, async text() { return ''; } };
    }

    const parsed = new URL(url);
    const path = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    assert.strictEqual(path[0], 'get');
    return {
      ok: true,
      async json() { return { result: redisStore.get(path[1]) ?? null }; },
      async text() { return ''; }
    };
  };

  const firstResponse = responseDouble();
  const secondResponse = responseDouble();
  const request = {
    method: 'POST', headers: { 'x-team-token': 'team-secret' },
    body: { operation: 'reserve-guide-issue', clientId: 'client-one' }, query: {}
  };
  try {
    const unauthenticatedResponse = responseDouble();
    await dataApi({ ...request, headers: {} }, unauthenticatedResponse);
    assert.strictEqual(unauthenticatedResponse.statusCode, 401);
    assert.strictEqual(setNxCalls, 0);

    await Promise.all([
      dataApi({ ...request }, firstResponse),
      dataApi({ ...request }, secondResponse)
    ]);
  } finally {
    global.fetch = previousFetch;
  }

  assert.strictEqual(firstResponse.statusCode, 200);
  assert.strictEqual(secondResponse.statusCode, 200);
  assert.strictEqual(setNxCalls, 2);
  assert.strictEqual(redisStore.size, 3);
  assert.deepStrictEqual(
    [firstResponse.body.created, secondResponse.body.created].sort(),
    [false, true]
  );
  assert.strictEqual(firstResponse.body.reservation.guide.id, secondResponse.body.reservation.guide.id);
  assert.match(firstResponse.body.reservation.guide.id, /^guide_[A-Za-z0-9_-]{24,}$/);
  assert.deepStrictEqual(
    JSON.parse(redisStore.get('rs:guide-issue:client-one')),
    firstResponse.body.reservation
  );
  assert.deepStrictEqual(
    JSON.parse(redisStore.get(`rs:guide:${firstResponse.body.reservation.guide.id}`)),
    firstResponse.body.reservation.guide
  );
});

test('authenticated issuance verifies the client and persists the public guide with service context before returning', async () => {
  const redisStore = new Map([
    ['rs:client:client-one', JSON.stringify({ id: 'client-one', service: 'SNS 운영 대행' })]
  ]);
  const previousFetch = global.fetch;
  const reads = [];
  global.fetch = async (url, options = {}) => {
    if (url === 'https://redis.example.test' && options.method === 'POST') {
      const command = JSON.parse(options.body);
      assert.strictEqual(command[0], 'SET');
      if (command[3] === 'NX' && redisStore.has(command[1])) {
        return { ok: true, async json() { return { result: null }; }, async text() { return ''; } };
      }
      redisStore.set(command[1], command[2]);
      return { ok: true, async json() { return { result: 'OK' }; }, async text() { return ''; } };
    }
    const path = new URL(url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    assert.strictEqual(path[0], 'get');
    reads.push(path[1]);
    return {
      ok: true,
      async json() { return { result: redisStore.get(path[1]) ?? null }; },
      async text() { return ''; }
    };
  };
  const response = responseDouble();
  try {
    await dataApi({
      method: 'POST', headers: { 'x-team-token': 'team-secret' }, query: {},
      body: { operation: 'reserve-guide-issue', clientId: 'client-one' }
    }, response);
  } finally {
    global.fetch = previousFetch;
  }

  assert.strictEqual(response.statusCode, 200);
  assert.ok(reads.includes('rs:client:client-one'));
  const guide = response.body.reservation.guide;
  assert.strictEqual(guide.serviceContext, 'SNS 운영 대행');
  assert.deepStrictEqual(JSON.parse(redisStore.get(`rs:guide:${guide.id}`)), guide);
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

test('newGuide creates a unique opaque public document without internal review fields', () => {
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
  assert.strictEqual(Object.prototype.hasOwnProperty.call(first, 'review'), false);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.newGuideReview(first))), {
    guideId: first.id, clientId: 'client-one', status: 'unreviewed', memo: ''
  });
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

test('guide reads distinguish confirmed absence from transport and invalid JSON errors', async () => {
  const readerMatch = html.match(/(async function readS[\s\S]*?)(?=\n  async function getS)/);
  assert.ok(readerMatch, 'guide-specific typed storage reader must exist');
  const outcomes = [
    Object.assign(new Error('missing'), { code: 'not_found' }),
    new Error('redis unavailable'),
    { value: '{invalid json' },
    { value: '{"id":"guide_ok"}' }
  ];
  const sandbox = {
    JSON,
    storageBackend: {
      async get() {
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return outcome;
      }
    }
  };
  vm.runInNewContext(readerMatch[1], sandbox);

  assert.strictEqual((await sandbox.readS('guide:one')).status, 'missing');
  assert.strictEqual((await sandbox.readS('guide:one')).status, 'error');
  assert.strictEqual((await sandbox.readS('guide:one')).status, 'error');
  const found = await sandbox.readS('guide:one');
  assert.strictEqual(found.status, 'found');
  assert.strictEqual(found.value.id, 'guide_ok');
});

test('browser public guide mutation uses the dedicated guide endpoint and answers only', async () => {
  const backendMatch = html.match(/(var storageBackend = \{[\s\S]*?\n  \};)(?=\r?\n\r?\n  function forceLogout)/);
  assert.ok(backendMatch, 'storage backend must be independently testable');
  let request;
  const returnedGuide = {
    id: 'guide_permanent', clientId: 'client-one', createdAt: 1,
    updatedAt: 2, submittedAt: 2, answers: { goal: 'answer' }
  };
  const sandbox = {
    authHeaders() { return { 'x-team-token': 'must-not-be-used-for-field-ownership' }; },
    forceLogout() {},
    async fetch(url, options) {
      request = { url, options };
      return { ok: true, async json() { return { guide: returnedGuide }; } };
    }
  };
  vm.runInNewContext(backendMatch[1], sandbox);

  assert.strictEqual(
    await sandbox.storageBackend.mutatePublicGuide('guide_permanent', { goal: 'answer' }, true),
    returnedGuide
  );
  assert.strictEqual(request.url, '/api/guide?id=guide_permanent&action=submit');
  assert.deepStrictEqual(JSON.parse(request.options.body), { answers: { goal: 'answer' } });
});

test('public guide transport errors render a retry state while invalid IDs render missing', async () => {
  const loaderMatch = html.match(/(function renderPublicGuideUnavailable[\s\S]*?\n  async function loadPublicGuidePage[\s\S]*?\n  })(?=\n\n  \/\* ============ state)/);
  assert.ok(loaderMatch, 'public guide load state renderer must exist');
  const retry = { onclick: null };
  const sandbox = {
    app: { innerHTML: '' },
    document: { getElementById(id) { return id === 'btn-retry-public-guide' ? retry : null; } },
    storageBackend: { async getPublicGuide() { throw new Error('network'); } },
    guideStatus() { return 'draft'; },
    renderGuideComplete() { return 'complete'; },
    mountPublicGuide() {},
    setTimeout,
    encodeURIComponent
  };
  vm.runInNewContext(loaderMatch[1], sandbox);

  assert.strictEqual(await sandbox.loadPublicGuidePage('guide_abcdefghijklmnopqrstuvwx'), 'error');
  assert.match(sandbox.app.innerHTML, /안내문을 불러오지 못했습니다/);
  assert.match(sandbox.app.innerHTML, /다시 시도/);
  assert.strictEqual(typeof retry.onclick, 'function');

  assert.strictEqual(await sandbox.loadPublicGuidePage('not-a-guide-id'), 'missing');
  assert.match(sandbox.app.innerHTML, /찾을 수 없는 안내문입니다/);
  assert.doesNotMatch(sandbox.app.innerHTML, /불러오지 못했습니다/);
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

  const contextualMarkup = sandbox.renderPublicGuide({ serviceContext: 'SNS 운영 대행', answers: {} });
  assert.match(contextualMarkup, /계약 서비스/);
  assert.match(contextualMarkup, /SNS 운영 대행/);
});

test('draft and submitted public saves send only answer operations for the same permanent guide', async () => {
  const saverMatch = html.match(/(async function savePublicGuide[\s\S]*?)(?=\n  function renderGuideComplete)/);
  assert.ok(saverMatch, 'savePublicGuide must be independently testable');
  const writes = [];
  const sandbox = {
    JSON,
    Promise,
    publicGuideSaveChain: Promise.resolve(true),
    async mutatePublicGuide(guideId, answers, submitted) {
      writes.push({ guideId, answers: JSON.parse(JSON.stringify(answers)), submitted });
      const savedAt = 1700000000100 + writes.length;
      return {
        id: guideId, clientId: 'client-one', createdAt: 1700000000000,
        updatedAt: savedAt, submittedAt: submitted ? savedAt : null,
        answers: JSON.parse(JSON.stringify(answers))
      };
    }
  };
  vm.runInNewContext(saverMatch[1], sandbox);

  const guide = { id: 'guide_permanent', createdAt: 1700000000000, updatedAt: 1700000000000, submittedAt: null, answers: {} };
  assert.strictEqual(await sandbox.savePublicGuide(guide, false), true);
  assert.strictEqual(await sandbox.savePublicGuide(guide, true), true);
  assert.deepStrictEqual(writes.map((write) => write.guideId), ['guide_permanent', 'guide_permanent']);
  assert.deepStrictEqual(writes.map((write) => write.submitted), [false, true]);
  assert.deepStrictEqual(Object.keys(writes[0]).sort(), ['answers', 'guideId', 'submitted']);
  assert.strictEqual(guide.updatedAt, 1700000000102);
  assert.strictEqual(guide.submittedAt, 1700000000102);
});

test('a failed submission never marks the local guide as submitted', async () => {
  const saverMatch = html.match(/(async function savePublicGuide[\s\S]*?)(?=\n  function renderGuideComplete)/);
  assert.ok(saverMatch, 'savePublicGuide must be independently testable');
  let mutations = 0;
  const sandbox = {
    JSON,
    Promise,
    publicGuideSaveChain: Promise.resolve(true),
    async mutatePublicGuide() { mutations += 1; return null; }
  };
  vm.runInNewContext(saverMatch[1], sandbox);

  const guide = { id: 'guide_failed', createdAt: 1700000000000, updatedAt: 1700000000000, submittedAt: null, answers: {} };
  assert.strictEqual(await sandbox.savePublicGuide(guide, true), false);
  assert.strictEqual(mutations, 1);
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
    JSON,
    Promise,
    publicGuideSaveChain: Promise.resolve(true),
    publicGuideSaveTimer: null,
    publicGuideRevision: 0,
    publicGuideSubmitting: false,
    publicGuideSavePending: false,
    clearTimeout() {},
    setTimeout(callback) { callback(); return 1; },
    async mutatePublicGuide(guideId, answers, submitted) {
      writes.push({ guideId, answers: JSON.parse(JSON.stringify(answers)), submitted });
      if (writes.length === 1) await new Promise((resolve) => { releaseSubmit = resolve; });
      const priorSubmission = writes.slice(0, -1).some((write) => write.submitted);
      return {
        id: guideId, clientId: 'client-one', createdAt: 1700000000000,
        updatedAt: 1700000000200 + writes.length,
        submittedAt: submitted || priorSubmission ? 1700000000201 : null,
        answers: JSON.parse(JSON.stringify(answers))
      };
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
  assert.strictEqual(writes[0].submitted, true);
  assert.strictEqual(writes[1].submitted, false);
  assert.strictEqual(writes[1].answers.goal, 'typed during submit');
  assert.strictEqual(guide.submittedAt, 1700000000201);
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

test('client detail provides the information-guide tab and management controls', () => {
  assert.match(html, /data-client-tab="guide"/);
  assert.match(html, /id="btn-issue-guide"/);
  assert.match(html, /id="btn-copy-guide"/);
  assert.match(html, /id="guide-review-status"/);
  assert.match(html, /id="guide-review-memo"/);
  assert.match(html, /추가 확인 필요/);
});

test('legacy clients see only the guide purpose and explicit issue action before issuance', () => {
  const panelMatch = html.match(/(function informationGuidePanel[\s\S]*?)(?=\n  async function issueGuideForClient)/);
  assert.ok(panelMatch, 'informationGuidePanel must be independently testable');
  const sandbox = {
    esc(value) { return String(value == null ? '' : value); },
    guideSummary() { return []; },
    guideFollowUps() { return []; },
    guideStatus() { return 'not_started'; },
    fmtGuideTimestamp() { return '2026.08.11 10:30'; },
    location: { origin: 'https://dashboard.example.test' },
    encodeURIComponent
  };
  vm.runInNewContext(panelMatch[1], sandbox);

  const markup = sandbox.informationGuidePanel({ id: 'legacy-client', name: '기존 업체' }, null);
  assert.match(markup, /설문 링크 발급/);
  assert.match(markup, /안내문/);
  assert.doesNotMatch(markup, /btn-copy-guide|btn-preview-guide|guide-review-status|guide-review-memo/);
});

test('issued guide panel shows permanent-link management, answers, follow-ups, and review controls', () => {
  const panelMatch = html.match(/(function informationGuidePanel[\s\S]*?)(?=\n  async function issueGuideForClient)/);
  assert.ok(panelMatch, 'informationGuidePanel must be independently testable');
  const sandbox = {
    esc(value) { return String(value == null ? '' : value); },
    guideSummary() { return [{ label: '최우선 마케팅 목표', value: '재방문 확대' }]; },
    guideFollowUps() { return ['자료 별도 전달 확인']; },
    guideStatus() { return 'submitted'; },
    fmtGuideTimestamp(timestamp) {
      if (timestamp === 1700000000400) return '최근 시각';
      if (timestamp === 1700000000200) return '제출 시각';
      return '기타 시각';
    },
    location: { origin: 'https://dashboard.example.test' },
    encodeURIComponent
  };
  vm.runInNewContext(panelMatch[1], sandbox);

  const markup = sandbox.informationGuidePanel(
    { id: 'client-one', guideId: 'guide_permanent' },
    {
      id: 'guide_permanent', submittedAt: 1700000000200, updatedAt: 1700000000400,
      answers: { goal: '재방문 확대', materialStatus: '별도 전달 예정' }
    },
    { guideId: 'guide_permanent', status: 'reviewing', memo: '자료 도착 후 확인' }
  );
  assert.match(markup, /https:\/\/dashboard\.example\.test\/\?guide=guide_permanent/);
  assert.match(markup, /제출 완료/);
  assert.match(markup, /최근 저장 최근 시각/);
  assert.match(markup, /제출 제출 시각/);
  assert.match(markup, /최우선 마케팅 목표/);
  assert.match(markup, /재방문 확대/);
  assert.match(markup, /<details/);
  assert.match(markup, /자료 별도 전달 확인/);
  assert.match(markup, /id="guide-review-status"/);
  assert.match(markup, /value="reviewing" selected/);
  assert.match(markup, /id="guide-review-memo"/);
  assert.match(markup, /자료 도착 후 확인/);
  assert.doesNotMatch(markup, /재발급|링크 회수|안내문 삭제/);
});

test('private guide panel distinguishes confirmed missing records from retryable read errors', () => {
  const panelMatch = html.match(/(function informationGuidePanel[\s\S]*?)(?=\n  async function issueGuideForClient)/);
  assert.ok(panelMatch, 'informationGuidePanel must be independently testable');
  const sandbox = {
    esc(value) { return String(value == null ? '' : value); },
    guideSummary() { return []; }, guideFollowUps() { return []; }, guideStatus() { return 'draft'; },
    fmtGuideTimestamp() { return 'time'; }, location: { origin: 'https://dashboard.example.test' }, encodeURIComponent
  };
  vm.runInNewContext(panelMatch[1], sandbox);
  const client = { id: 'client-one', guideId: 'guide_permanent' };

  const missing = sandbox.informationGuidePanel(client, null, null, 'missing', 'idle');
  assert.match(missing, /안내문을 찾을 수 없습니다/);
  assert.doesNotMatch(missing, /불러오지 못했습니다/);

  const error = sandbox.informationGuidePanel(client, null, null, 'error', 'idle');
  assert.match(error, /안내문을 불러오지 못했습니다/);
  assert.match(error, /id="btn-retry-guide"/);
});

test('private review read errors disable saving and expose retry without a blank fallback', () => {
  const panelMatch = html.match(/(function informationGuidePanel[\s\S]*?)(?=\n  async function issueGuideForClient)/);
  assert.ok(panelMatch, 'informationGuidePanel must be independently testable');
  const sandbox = {
    esc(value) { return String(value == null ? '' : value); },
    guideSummary() { return []; }, guideFollowUps() { return []; }, guideStatus() { return 'draft'; },
    fmtGuideTimestamp() { return 'time'; }, location: { origin: 'https://dashboard.example.test' }, encodeURIComponent
  };
  vm.runInNewContext(panelMatch[1], sandbox);
  const markup = sandbox.informationGuidePanel(
    { id: 'client-one', guideId: 'guide_permanent' },
    { id: 'guide_permanent', clientId: 'client-one', createdAt: 1, updatedAt: 2, submittedAt: null, answers: {} },
    null,
    'ready',
    'error'
  );

  assert.match(markup, /검토 정보를 불러오지 못했습니다/);
  assert.match(markup, /id="btn-retry-guide"/);
  assert.match(markup, /id="guide-review-status"[^>]*disabled/);
  assert.match(markup, /id="guide-review-memo"[^>]*disabled/);
  assert.match(markup, /id="btn-save-guide-review"[^>]*disabled/);
});

test('private guide loading never replaces a review after a read error but may initialize a confirmed 404', async () => {
  const selectorMatch = html.match(/(async function selectClientWorkspaceTab[\s\S]*?)(?=\n  function setChecklistCollectionOpen)/);
  assert.ok(selectorMatch, 'guide tab loader must be independently testable');
  const client = { id: 'client-one', guideId: 'guide_permanent' };
  const guide = { id: 'guide_permanent', clientId: 'client-one', answers: {} };
  let reviewCreations = 0;
  const state = { currentClient: client, clientTab: 'guide' };
  const reads = [
    { status: 'found', value: guide },
    { status: 'error', error: new Error('redis unavailable') }
  ];
  const sandbox = {
    state,
    async readS() { return reads.shift(); },
    newGuideReview() { reviewCreations += 1; return { status: 'unreviewed', memo: '' }; },
    setClientWorkspaceTab(tab) { state.clientTab = tab; },
    renderClientWorkspace() {}
  };
  vm.runInNewContext(selectorMatch[1], sandbox);
  await sandbox.selectClientWorkspaceTab(client, 'guide');
  assert.strictEqual(state.currentGuide, guide);
  assert.strictEqual(state.currentGuideLoadState, 'ready');
  assert.strictEqual(state.currentGuideReview, null);
  assert.strictEqual(state.currentGuideReviewLoadState, 'error');
  assert.strictEqual(reviewCreations, 0, 'a transport error must never become an empty review');

  reads.push({ status: 'found', value: guide }, { status: 'missing' });
  await sandbox.selectClientWorkspaceTab(client, 'guide');
  assert.strictEqual(state.currentGuideReview.status, 'unreviewed');
  assert.strictEqual(state.currentGuideReviewLoadState, 'missing');
  assert.strictEqual(reviewCreations, 1);

  reads.push(
    { status: 'found', value: guide },
    { status: 'found', value: { guideId: guide.id, clientId: 'client-one', status: 'invalid-status', memo: 42 } }
  );
  await sandbox.selectClientWorkspaceTab(client, 'guide');
  assert.strictEqual(state.currentGuideReview, null);
  assert.strictEqual(state.currentGuideReviewLoadState, 'error');
  assert.strictEqual(reviewCreations, 1, 'invalid stored review data must not become a blank review');
});

test('guide tab repairs and reconnects an existing issuance when the client link is missing', async () => {
  const selectorMatch = html.match(/(async function selectClientWorkspaceTab[\s\S]*?)(?=\n  function setChecklistCollectionOpen)/);
  assert.ok(selectorMatch, 'guide tab loader must be independently testable');
  const client = { id: 'client-one', name: 'linked later' };
  const guide = { id: 'guide_recovered', clientId: 'client-one', createdAt: 1, updatedAt: 2, submittedAt: null, answers: {} };
  const state = { currentClient: client, clientTab: 'guide' };
  const reads = [];
  const reservations = [];
  const writes = [];
  const sandbox = {
    state,
    setClientWorkspaceTab(tab) { state.clientTab = tab; },
    renderClientWorkspace() {},
    newGuideReview() { return { guideId: guide.id, clientId: guide.clientId, status: 'unreviewed', memo: '' }; },
    async reserveGuideIssue(clientId) {
      reservations.push(clientId);
      return { guide };
    },
    async readS(key) {
      reads.push(key);
      if (key === 'guide:guide_recovered') return { status: 'found', value: guide };
      if (key === 'guide-review:guide_recovered') return { status: 'missing' };
      throw new Error(`unexpected read ${key}`);
    },
    async setS(key, value) {
      writes.push({ key, value: JSON.parse(JSON.stringify(value)) });
      return { key };
    }
  };
  vm.runInNewContext(selectorMatch[1], sandbox);

  await sandbox.selectClientWorkspaceTab(client, 'guide');

  assert.deepStrictEqual(reservations, ['client-one']);
  assert.deepStrictEqual(reads, ['guide:guide_recovered', 'guide-review:guide_recovered']);
  assert.strictEqual(client.guideId, 'guide_recovered');
  assert.strictEqual(state.currentGuide, guide);
  assert.strictEqual(state.currentGuideLoadState, 'ready');
  assert.strictEqual(state.currentGuideReviewLoadState, 'missing');
  assert.deepStrictEqual(writes, [{ key: 'client:client-one', value: { id: 'client-one', name: 'linked later', guideId: 'guide_recovered' } }]);
});

test('manual issuance trusts the server-persisted guide and stores only private review plus client link', async () => {
  const issuerMatch = html.match(/(async function issueGuideForClient[\s\S]*?)(?=\n  async function saveGuideReview)/);
  assert.ok(issuerMatch, 'issueGuideForClient must be independently testable');
  const writes = [];
  const storage = new Map([
    ['client:client-one', { id: 'client-one', name: '저장소의 최신 업체명', checklist: [{ id: 'task-one' }], memo: '유지할 메모' }]
  ]);
  const reservedGuide = { id: 'guide_once', clientId: 'client-one', createdAt: 100, updatedAt: 100, submittedAt: null, answers: {} };
  let creations = 0;
  let reservations = 0;
  const sandbox = {
    Object,
    async getS(key) {
      if (key.startsWith('guide:')) throw new Error('server-issued guide must not be read then replaced');
      return storage.has(key) ? JSON.parse(JSON.stringify(storage.get(key))) : null;
    },
    async readS(key) {
      assert.strictEqual(key, 'guide-review:guide_once');
      return { status: 'missing' };
    },
    newGuide(clientId) {
      creations += 1;
      return { id: 'guide_once', clientId, createdAt: 100, updatedAt: 100, submittedAt: null, answers: {} };
    },
    async reserveGuideIssue(clientId) {
      assert.strictEqual(clientId, 'client-one');
      reservations += 1;
      return { guide: JSON.parse(JSON.stringify(reservedGuide)) };
    },
    newGuideReview(guide) {
      return { guideId: guide.id, clientId: guide.clientId, status: 'unreviewed', memo: '' };
    },
    async setS(key, value) {
      writes.push({ key, value: JSON.parse(JSON.stringify(value)) });
      storage.set(key, JSON.parse(JSON.stringify(value)));
      return { key };
    }
  };
  vm.runInNewContext(issuerMatch[1], sandbox);

  const client = { id: 'client-one', name: '오래된 업체명' };
  const guide = await sandbox.issueGuideForClient(client);
  assert.strictEqual(guide.id, 'guide_once');
  assert.deepStrictEqual(writes.map((write) => write.key), [
    'guide-review:guide_once', 'client:client-one'
  ]);
  assert.strictEqual(reservations, 1);
  assert.strictEqual(creations, 0);
  const linkedClient = writes[1].value;
  assert.strictEqual(linkedClient.guideId, 'guide_once');
  assert.strictEqual(linkedClient.name, '저장소의 최신 업체명');
  assert.deepStrictEqual(linkedClient.checklist, [{ id: 'task-one' }]);
  assert.strictEqual(linkedClient.memo, '유지할 메모');
  assert.strictEqual(client.guideId, 'guide_once');
});

test('manual issuance never writes a blank review after a private review read error', async () => {
  const issuerMatch = html.match(/(async function issueGuideForClient[\s\S]*?)(?=\n  async function saveGuideReview)/);
  assert.ok(issuerMatch, 'issueGuideForClient must be independently testable');
  const writes = [];
  const reservedGuide = {
    id: 'guide_review_safe', clientId: 'client-one', createdAt: 100,
    updatedAt: 100, submittedAt: null, answers: {}
  };
  const sandbox = {
    Object,
    async getS(key) {
      if (key === 'client:client-one') return { id: 'client-one' };
      return null;
    },
    async readS(key) {
      assert.strictEqual(key, 'guide-review:guide_review_safe');
      return { status: 'error', error: new Error('redis unavailable') };
    },
    async reserveGuideIssue() { return { guide: reservedGuide }; },
    newGuideReview() { throw new Error('must not create a review after a read error'); },
    async setS(key, value) { writes.push({ key, value }); return { key }; }
  };
  vm.runInNewContext(issuerMatch[1], sandbox);

  assert.strictEqual(await sandbox.issueGuideForClient({ id: 'client-one' }), null);
  assert.deepStrictEqual(writes, []);
});

test('a stale client session loads the already-issued guide instead of replacing it', async () => {
  const issuerMatch = html.match(/(async function issueGuideForClient[\s\S]*?)(?=\n  async function saveGuideReview)/);
  assert.ok(issuerMatch, 'issueGuideForClient must be independently testable');
  const writes = [];
  let creations = 0;
  const existingGuide = { id: 'guide_existing', answers: { goal: '유지' } };
  const sandbox = {
    Object,
    newGuide() { creations += 1; return { id: 'guide_replacement' }; },
    newGuideReview() { throw new Error('existing issuance must not create review data'); },
    async reserveGuideIssue() { throw new Error('stored guideId must win before reservation'); },
    async getS(key) {
      if (key === 'client:client-one') return { id: 'client-one', name: '최신 업체', guideId: 'guide_existing' };
      if (key === 'guide:guide_existing') return existingGuide;
      throw new Error(`unexpected read ${key}`);
    },
    async setS(key, value) { writes.push({ key, value }); return { key }; }
  };
  vm.runInNewContext(issuerMatch[1], sandbox);

  const client = { id: 'client-one', name: '오래된 업체' };
  assert.strictEqual(await sandbox.issueGuideForClient(client), existingGuide);
  assert.strictEqual(client.guideId, 'guide_existing');
  assert.strictEqual(creations, 0);
  assert.deepStrictEqual(writes, []);
});

test('a partial issuance retry reuses the recovery marker and never creates a second public guide', async () => {
  const issuerMatch = html.match(/(async function issueGuideForClient[\s\S]*?)(?=\n  async function saveGuideReview)/);
  assert.ok(issuerMatch, 'issueGuideForClient must be independently testable');
  const storage = new Map([
    ['client:client-one', { id: 'client-one', name: '업체' }]
  ]);
  const writes = [];
  let creations = 0;
  let reservations = 0;
  let failClientLink = true;
  const reservedGuide = {
    id: 'guide_recoverable', clientId: 'client-one', createdAt: 100, updatedAt: 100,
    submittedAt: null, answers: {}
  };
  const sandbox = {
    Object,
    async getS(key) { return storage.has(key) ? JSON.parse(JSON.stringify(storage.get(key))) : null; },
    async readS(key) {
      return storage.has(key)
        ? { status: 'found', value: JSON.parse(JSON.stringify(storage.get(key))) }
        : { status: 'missing' };
    },
    newGuide(clientId) {
      creations += 1;
      return { ...reservedGuide, clientId };
    },
    async reserveGuideIssue(clientId) {
      assert.strictEqual(clientId, 'client-one');
      reservations += 1;
      return { guide: JSON.parse(JSON.stringify(reservedGuide)) };
    },
    newGuideReview(guide) {
      return { guideId: guide.id, clientId: guide.clientId, status: 'unreviewed', memo: '' };
    },
    async setS(key, value) {
      writes.push({ key, value: JSON.parse(JSON.stringify(value)) });
      if (key === 'client:client-one' && failClientLink) {
        failClientLink = false;
        return null;
      }
      storage.set(key, JSON.parse(JSON.stringify(value)));
      return { key };
    }
  };
  vm.runInNewContext(issuerMatch[1], sandbox);

  const client = { id: 'client-one' };
  assert.strictEqual(await sandbox.issueGuideForClient(client), null);
  assert.strictEqual(client.guideId, undefined);
  const retried = await sandbox.issueGuideForClient(client);
  assert.strictEqual(retried.id, 'guide_recoverable');
  assert.strictEqual(client.guideId, 'guide_recoverable');
  assert.strictEqual(reservations, 2);
  assert.strictEqual(creations, 0);
  assert.strictEqual(writes.filter((write) => write.key === 'guide:guide_recoverable').length, 0);
  assert.strictEqual(storage.get('client:client-one').guideId, 'guide_recoverable');
});

test('concurrent stale sessions reuse one atomic reservation and store no orphan public guide', async () => {
  const issuerMatch = html.match(/(async function issueGuideForClient[\s\S]*?)(?=\n  async function saveGuideReview)/);
  assert.ok(issuerMatch, 'issueGuideForClient must be independently testable');
  const storage = new Map([
    ['client:client-one', { id: 'client-one', name: '업체' }]
  ]);
  const writes = [];
  let creations = 0;
  let reservationCalls = 0;
  let openReservationGate;
  const reservationGate = new Promise((resolve) => { openReservationGate = resolve; });
  const reservedGuide = {
    id: 'guide_atomic_reservation_1234567890', clientId: 'client-one',
    createdAt: 100, updatedAt: 100, submittedAt: null, answers: {}
  };
  const sandbox = {
    Object,
    async getS(key) {
      if (key === 'client:client-one' && !storage.get(key).guideId) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      return storage.has(key) ? JSON.parse(JSON.stringify(storage.get(key))) : null;
    },
    async readS(key) {
      return storage.has(key)
        ? { status: 'found', value: JSON.parse(JSON.stringify(storage.get(key))) }
        : { status: 'missing' };
    },
    newGuide(clientId) {
      creations += 1;
      return {
        id: `guide_orphan_${creations}_abcdefghijklmnopqrstuvwx`, clientId,
        createdAt: 100, updatedAt: 100, submittedAt: null, answers: {}
      };
    },
    async reserveGuideIssue(clientId) {
      assert.strictEqual(clientId, 'client-one');
      reservationCalls += 1;
      if (reservationCalls === 2) openReservationGate();
      await reservationGate;
      return { guide: JSON.parse(JSON.stringify(reservedGuide)) };
    },
    newGuideReview(guide) {
      return { guideId: guide.id, clientId: guide.clientId, status: 'unreviewed', memo: '' };
    },
    async setS(key, value) {
      writes.push({ key, value: JSON.parse(JSON.stringify(value)) });
      storage.set(key, JSON.parse(JSON.stringify(value)));
      return { key };
    }
  };
  vm.runInNewContext(issuerMatch[1], sandbox);

  const firstClient = { id: 'client-one', name: '첫 세션' };
  const secondClient = { id: 'client-one', name: '둘째 세션' };
  const [firstGuide, secondGuide] = await Promise.all([
    sandbox.issueGuideForClient(firstClient),
    sandbox.issueGuideForClient(secondClient)
  ]);

  assert.strictEqual(firstGuide.id, reservedGuide.id);
  assert.strictEqual(secondGuide.id, reservedGuide.id);
  assert.strictEqual(firstClient.guideId, reservedGuide.id);
  assert.strictEqual(secondClient.guideId, reservedGuide.id);
  assert.strictEqual(creations, 0);
  assert.strictEqual(reservationCalls, 2);
  assert.deepStrictEqual(
    [...new Set(writes.filter((write) => write.key.startsWith('guide:')).map((write) => write.key))],
    []
  );
});

test('saving an internal review writes only the authenticated review document', async () => {
  const saverMatch = html.match(/(async function saveGuideReview[\s\S]*?)(?=\n  function bindGuidePanel)/);
  assert.ok(saverMatch, 'saveGuideReview must be independently testable');
  const writes = [];
  const controls = {
    'guide-review-status': { value: 'reviewed' },
    'guide-review-memo': { value: '  확인 완료 메모  ' }
  };
  const sandbox = {
    Object,
    Date: { now() { return 400; } },
    document: { getElementById(id) { return controls[id] || null; } },
    async setS(key, value) {
      writes.push({ key, value: JSON.parse(JSON.stringify(value)) });
      return { key };
    }
  };
  vm.runInNewContext(saverMatch[1], sandbox);

  const guide = {
    id: 'guide_permanent', clientId: 'client-one', createdAt: 100, updatedAt: 200, submittedAt: 200,
    answers: { goal: '공개 목표', materialStatus: '없음' }
  };
  const review = { guideId: 'guide_permanent', clientId: 'client-one', status: 'unreviewed', memo: '이전 메모' };
  assert.strictEqual(await sandbox.saveGuideReview(guide, review), true);
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0].key, 'guide-review:guide_permanent');
  assert.deepStrictEqual(writes[0].value, {
    guideId: 'guide_permanent', clientId: 'client-one', status: 'reviewed',
    memo: '확인 완료 메모', updatedAt: 400
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(writes[0].value, 'answers'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(writes[0].value, 'submittedAt'), false);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(review)), writes[0].value);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(guide, 'review'), false);
});

test('interleaved public answer and internal review saves cannot overwrite each other', async () => {
  const publicSaverMatch = html.match(/(async function savePublicGuide[\s\S]*?)(?=\n  function renderGuideComplete)/);
  const reviewSaverMatch = html.match(/(async function saveGuideReview[\s\S]*?)(?=\n  function bindGuidePanel)/);
  assert.ok(publicSaverMatch, 'savePublicGuide must be independently testable');
  assert.ok(reviewSaverMatch, 'saveGuideReview must be independently testable');
  const storage = new Map();
  let releasePublic;
  const controls = {
    'guide-review-status': { value: 'reviewing' },
    'guide-review-memo': { value: '내부 전용' }
  };
  const sandbox = {
    Object,
    Date: { now() { return 500; } },
    JSON,
    Promise,
    publicGuideSaveChain: Promise.resolve(true),
    document: { getElementById(id) { return controls[id] || null; } },
    async mutatePublicGuide(guideId, answers, submitted) {
      await new Promise((resolve) => { releasePublic = resolve; });
      const value = {
        id: guideId, clientId: 'client-one', createdAt: 100, updatedAt: 500,
        submittedAt: submitted ? 500 : null,
        answers: JSON.parse(JSON.stringify(answers))
      };
      storage.set(`guide:${guideId}`, value);
      return value;
    },
    async setS(key, value) {
      storage.set(key, JSON.parse(JSON.stringify(value)));
      return { key };
    }
  };
  vm.runInNewContext(publicSaverMatch[1], sandbox);
  vm.runInNewContext(reviewSaverMatch[1], sandbox);

  const guide = {
    id: 'guide_interleaved', clientId: 'client-one', createdAt: 100, updatedAt: 100,
    submittedAt: null, answers: { goal: '최신 공개 답변' },
    review: { status: 'reviewed', memo: '공개 저장에서 제거되어야 함' }
  };
  const review = { guideId: guide.id, clientId: guide.clientId, status: 'unreviewed', memo: '' };
  const publicSave = sandbox.savePublicGuide(guide, true);
  while (!releasePublic) await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(await sandbox.saveGuideReview(guide, review), true);
  releasePublic();
  assert.strictEqual(await publicSave, true);

  assert.deepStrictEqual(storage.get('guide-review:guide_interleaved'), {
    guideId: 'guide_interleaved', clientId: 'client-one', status: 'reviewing', memo: '내부 전용', updatedAt: 500
  });
  assert.deepStrictEqual(storage.get('guide:guide_interleaved'), {
    id: 'guide_interleaved', clientId: 'client-one', createdAt: 100, updatedAt: 500,
    submittedAt: 500, answers: { goal: '최신 공개 답변' }
  });
});
