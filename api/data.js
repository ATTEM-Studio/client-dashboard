// /api/data.js — Upstash Redis(REST) 기반 데이터 저장소
//
// 필요한 환경변수 (Vercel Marketplace에서 Upstash Redis 연결 시 자동 주입):
//   KV_REST_API_URL, KV_REST_API_TOKEN
// 직접 설정해야 하는 환경변수:
//   TEAM_PASSWORD  — 팀원이 대시보드에 접속할 때 입력하는 공용 비밀번호

const crypto = require("crypto");

const PREFIX = "rs:";

function redisEnv() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

async function redis(command, pathParts, body) {
  const { url, token } = redisEnv();
  if (!url || !token) {
    throw new Error("REDIS_NOT_CONFIGURED");
  }
  const path = [command, ...pathParts].map(encodeURIComponent).join("/");
  const res = await fetch(`${url}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "text/plain" }),
    },
    ...(body === undefined ? {} : { body }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`REDIS_ERROR ${res.status} ${text}`);
  }
  return res.json();
}

async function redisCommand(parts) {
  const { url, token } = redisEnv();
  if (!url || !token) {
    throw new Error("REDIS_NOT_CONFIGURED");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parts),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`REDIS_ERROR ${res.status} ${text}`);
  }
  return res.json();
}

function isAuthed(req) {
  const expected = process.env.TEAM_PASSWORD;
  if (!expected) return false;
  const given =
    req.headers["x-team-token"] ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return given === expected;
}

function isPublicGuideKey(key) {
  return typeof key === "string" && /^guide:guide_[A-Za-z0-9_-]{24,}$/.test(key);
}
function isPublicContractKey(key) {
  return typeof key === "string" && /^contract:contract_[A-Za-z0-9_-]{24,}$/.test(key);
}

// 리포트와 고엔트로피 안내문 링크는 인증 없이 읽기 허용
function isPublicReadable(key) {
  return typeof key === "string" && (key.startsWith("report:") || isPublicGuideKey(key) || isPublicContractKey(key));
}

const PUBLIC_GUIDE_FIELDS = ["id", "clientId", "createdAt", "updatedAt", "submittedAt", "serviceContext", "answers"];
const PUBLIC_GUIDE_ANSWER_FIELDS = [
  "concern", "goal", "priorityMenu", "currentCustomers", "desiredCustomers", "strengths",
  "story", "contentTone", "avoidExpressions", "materialStatus", "approverName",
  "approverContact", "operatingNotes",
];

const PUBLIC_GUIDE_MUTATION_SCRIPT = `
local storedValue = redis.call("GET", KEYS[1])
if not storedValue then return cjson.encode({ status = "missing-guide" }) end

local guideOk, guide = pcall(cjson.decode, storedValue)
if not guideOk or type(guide) ~= "table" or
   guide.id ~= ARGV[1] or guide.clientId ~= ARGV[2] or
   type(guide.createdAt) ~= "number" or type(guide.updatedAt) ~= "number" or
   (guide.submittedAt ~= cjson.null and type(guide.submittedAt) ~= "number") or
   type(guide.answers) ~= "table" then
  return cjson.encode({ status = "invalid-guide" })
end

local issueValue = redis.call("GET", KEYS[2])
if not issueValue then return cjson.encode({ status = "missing-issue" }) end
local issueOk, reservation = pcall(cjson.decode, issueValue)
if not issueOk or type(reservation) ~= "table" or type(reservation.guide) ~= "table" or
   reservation.guide.id ~= ARGV[1] or reservation.guide.clientId ~= ARGV[2] then
  return cjson.encode({ status = "invalid-issue" })
end

local answersOk, requestedAnswers = pcall(cjson.decode, ARGV[4])
if not answersOk or type(requestedAnswers) ~= "table" then
  return cjson.encode({ status = "invalid-answers" })
end
local answerFields = cjson.decode('${JSON.stringify(PUBLIC_GUIDE_ANSWER_FIELDS)}')
local mergedAnswers = {}
for _, field in ipairs(answerFields) do
  if type(guide.answers[field]) == "string" then mergedAnswers[field] = guide.answers[field] end
  if type(requestedAnswers[field]) == "string" then mergedAnswers[field] = requestedAnswers[field] end
end

local serverTime = redis.call("TIME")
local now = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)
local updatedAt = now
if guide.updatedAt > updatedAt then updatedAt = guide.updatedAt end
if type(guide.submittedAt) == "number" and guide.submittedAt > updatedAt then updatedAt = guide.submittedAt end
local submittedAt = guide.submittedAt
if submittedAt == cjson.null and ARGV[3] == "1" then submittedAt = now end

local mergedGuide = {
  id = guide.id,
  clientId = guide.clientId,
  createdAt = guide.createdAt,
  updatedAt = updatedAt,
  submittedAt = submittedAt,
  answers = mergedAnswers
}
if type(guide.serviceContext) == "string" then
  local serviceContext = string.match(guide.serviceContext, "^%s*(.-)%s*$")
  if serviceContext ~= "" then mergedGuide.serviceContext = serviceContext end
end
local mergedValue = cjson.encode(mergedGuide)
if string.len(mergedValue) > 2000000 then return cjson.encode({ status = "too-large" }) end
redis.call("SET", KEYS[1], mergedValue)
return cjson.encode({ status = "ok", guide = mergedGuide })
`;

const PUBLIC_CONTRACT_FIELDS = [
  "id", "clientId", "clientName", "contractType", "renewalCount", "productType", "productName",
  "supplyPrice", "paymentMethod", "businessNumber", "contact", "email", "startDate",
  "contractMonths", "fee", "terms", "specialTerms", "baseTerms", "signerName",
  "signatureDataUrl", "createdAt", "updatedAt", "submittedAt",
];

function sanitizePublicContractObject(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  if (typeof source.id !== "string" || !/^contract_[A-Za-z0-9_-]{24,}$/.test(source.id)) return null;
  const out = {};
  for (const field of PUBLIC_CONTRACT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) out[field] = source[field];
  }
  if (typeof out.clientId !== "string" || !out.clientId) out.clientId = `cl_${source.id.slice("contract_".length, 18)}`;
  if (out.contractType !== "renewal") out.contractType = "new";
  const count = Number(out.renewalCount);
  out.renewalCount = Number.isInteger(count) && count > 0 ? count : 1;
  out.updatedAt = Number.isFinite(Number(out.updatedAt)) ? Number(out.updatedAt) : Date.now();
  out.createdAt = Number.isFinite(Number(out.createdAt)) ? Number(out.createdAt) : out.updatedAt;
  if (out.submittedAt !== null && out.submittedAt !== undefined && !Number.isFinite(Number(out.submittedAt))) delete out.submittedAt;
  return out;
}

function sanitizePublicContractValue(value) {
  try {
    const sanitized = sanitizePublicContractObject(JSON.parse(value));
    return sanitized ? JSON.stringify(sanitized) : null;
  } catch {
    return null;
  }
}

function newGuideIssueReservation(clientId, serviceContext) {
  const now = Date.now();
  const answers = {};
  for (const field of PUBLIC_GUIDE_ANSWER_FIELDS) answers[field] = "";
  const guide = {
    id: `guide_${crypto.randomBytes(24).toString("hex")}`,
    clientId,
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    answers,
  };
  if (typeof serviceContext === "string" && serviceContext.trim()) {
    guide.serviceContext = serviceContext.trim();
  }
  return { guide };
}

function isValidGuideIssueReservation(value, clientId) {
  return Boolean(
    value && typeof value === "object" && !Array.isArray(value) &&
    value.guide && typeof value.guide === "object" && !Array.isArray(value.guide) &&
    typeof value.guide.id === "string" && /^guide_[A-Za-z0-9_-]{24,}$/.test(value.guide.id) &&
    value.guide.clientId === clientId
  );
}

function sanitizePublicGuideValue(value) {
  try {
    const source = JSON.parse(value);
    if (!source || typeof source !== "object" || Array.isArray(source)) return null;
    const sanitized = {};
    for (const field of PUBLIC_GUIDE_FIELDS) {
      if (field === "answers") continue;
      if (Object.prototype.hasOwnProperty.call(source, field)) sanitized[field] = source[field];
    }
    const answers = source.answers && typeof source.answers === "object" && !Array.isArray(source.answers)
      ? source.answers
      : {};
    sanitized.answers = {};
    for (const field of PUBLIC_GUIDE_ANSWER_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(answers, field)) sanitized.answers[field] = answers[field];
    }
    return JSON.stringify(sanitized);
  } catch {
    return null;
  }
}

function parseStoredGuide(value, guideId) {
  try {
    const guide = JSON.parse(value);
    if (
      !guide || typeof guide !== "object" || Array.isArray(guide) ||
      guide.id !== guideId || typeof guide.clientId !== "string" ||
      !Number.isFinite(guide.createdAt) || !Number.isFinite(guide.updatedAt) ||
      (guide.submittedAt !== null && !Number.isFinite(guide.submittedAt)) ||
      !guide.answers || typeof guide.answers !== "object"
    ) {
      return null;
    }
    if (Array.isArray(guide.answers)) {
      if (guide.answers.length) return null;
      guide.answers = {};
    }
    return guide;
  } catch {
    return null;
  }
}

function normalizeMutatedGuide(value, guideId) {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    value.id !== guideId || typeof value.clientId !== "string" ||
    !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt) ||
    (value.submittedAt !== null && !Number.isFinite(value.submittedAt))
  ) {
    return null;
  }
  const sourceAnswers = value.answers && typeof value.answers === "object" && !Array.isArray(value.answers)
    ? value.answers
    : {};
  const answers = {};
  for (const field of PUBLIC_GUIDE_ANSWER_FIELDS) {
    if (typeof sourceAnswers[field] === "string") answers[field] = sourceAnswers[field];
  }
  const guide = {
    id: value.id,
    clientId: value.clientId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    submittedAt: value.submittedAt,
    answers,
  };
  if (typeof value.serviceContext === "string" && value.serviceContext.trim()) {
    guide.serviceContext = value.serviceContext.trim();
  }
  return guide;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  try {
    if (!process.env.TEAM_PASSWORD) {
      return res.status(500).json({
        error: "TEAM_PASSWORD 환경변수가 설정되지 않았습니다. Vercel 프로젝트 설정에서 추가해 주세요.",
      });
    }

    const method = req.method;

    if (method === "GET") {
      const key = req.query.key;
      if (!key) return res.status(400).json({ error: "key가 필요합니다" });
      if (!isAuthed(req) && !isPublicReadable(key)) {
        return res.status(401).json({ error: "인증이 필요합니다" });
      }
      const out = await redis("get", [PREFIX + key]);
      if (out.result === null || out.result === undefined) {
        return res.status(404).json({ error: "해당 키를 찾을 수 없습니다" });
      }
      if (isPublicGuideKey(key)) {
        const guideId = key.slice("guide:".length);
        const storedGuide = parseStoredGuide(out.result, guideId);
        const value = storedGuide ? sanitizePublicGuideValue(JSON.stringify(storedGuide)) : null;
        if (value === null) return res.status(500).json({ error: "안내문 데이터 형식이 올바르지 않습니다" });
        return res.status(200).json({ key, value });
      }
      if (isPublicContractKey(key)) {
        const value = sanitizePublicContractValue(out.result);
        if (value === null) return res.status(500).json({ error: "계약서 데이터 형식이 올바르지 않습니다" });
        return res.status(200).json({ key, value });
      }
      return res.status(200).json({ key, value: out.result });
    }

    if (method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      if (body && (body.operation === "save-public-contract" || body.operation === "submit-public-contract")) {
        const contractId = body.contractId;
        const key = "contract:" + contractId;
        if (!isPublicContractKey(key)) {
          return res.status(400).json({ error: "올바른 계약서 ID가 필요합니다" });
        }
        const existingResult = await redis("get", [PREFIX + key]);
        if (existingResult.result === null || existingResult.result === undefined) {
          return res.status(404).json({ error: "계약서를 찾을 수 없습니다" });
        }
        let existing = null;
        try { existing = JSON.parse(existingResult.result); } catch {}
        existing = sanitizePublicContractObject(existing);
        if (!existing || existing.id !== contractId) {
          return res.status(500).json({ error: "계약서 데이터 형식이 올바르지 않습니다" });
        }
        const requested = sanitizePublicContractObject(Object.assign({}, existing, body.contract || {}, {
          id: contractId,
          clientId: existing.clientId,
          createdAt: existing.createdAt,
        }));
        if (!requested) return res.status(400).json({ error: "계약서 입력값이 올바르지 않습니다" });
        requested.updatedAt = Date.now();
        if (body.operation === "submit-public-contract") requested.submittedAt = requested.submittedAt || requested.updatedAt;
        const fullContract = Object.assign({}, existing, requested);
        await redis("set", [PREFIX + key], JSON.stringify(fullContract));
        if (body.operation === "submit-public-contract") {
          const client = {
            id: fullContract.clientId,
            name: fullContract.clientName || "",
            industry: fullContract.productName || "",
            manager: fullContract.owner || "",
            contractType: fullContract.contractType === "renewal" ? "renewal" : "new",
            renewalCount: fullContract.contractType === "renewal" ? fullContract.renewalCount : undefined,
            startDate: fullContract.startDate || "",
            contractMonths: fullContract.contractMonths || "3",
            fee: fullContract.fee || fullContract.supplyPrice || "",
            status: "active",
            memo: fullContract.internalMemo || "",
            excludeWeekends: true,
            checklist: [],
            progress: {},
            renewals: [],
            createdAt: fullContract.createdAt,
            updatedAt: fullContract.updatedAt,
          };
          await redis("set", [PREFIX + "client:" + client.id], JSON.stringify(client));
          const clientsIndexResult = await redis("get", [PREFIX + "clients-index"]).catch(() => ({ result: null }));
          let clientsIndex = [];
          try { clientsIndex = JSON.parse(clientsIndexResult.result); } catch {}
          if (!Array.isArray(clientsIndex)) clientsIndex = [];
          clientsIndex = clientsIndex.filter((item) => item && item.id !== client.id);
          clientsIndex.push({ id: client.id, name: client.name, contractType: client.contractType, renewalCount: client.renewalCount, startDate: client.startDate, status: client.status, updatedAt: client.updatedAt });
          await redis("set", [PREFIX + "clients-index"], JSON.stringify(clientsIndex));
        }
        const contractsIndexResult = await redis("get", [PREFIX + "contracts-index"]).catch(() => ({ result: null }));
        let contractsIndex = [];
        try { contractsIndex = JSON.parse(contractsIndexResult.result); } catch {}
        if (!Array.isArray(contractsIndex)) contractsIndex = [];
        contractsIndex = contractsIndex.filter((item) => item && item.id !== fullContract.id);
        contractsIndex.push({ id: fullContract.id, clientId: fullContract.clientId, clientName: fullContract.clientName || "계약서 작성 대기", contractType: fullContract.contractType, renewalCount: fullContract.renewalCount, productName: fullContract.productName, startDate: fullContract.startDate, contractMonths: fullContract.contractMonths, fee: fullContract.fee, signerName: fullContract.signerName, submittedAt: fullContract.submittedAt, hasSignature: !!fullContract.signatureDataUrl, updatedAt: fullContract.updatedAt });
        await redis("set", [PREFIX + "contracts-index"], JSON.stringify(contractsIndex));
        return res.status(200).json({ contract: sanitizePublicContractObject(fullContract) });
      }
      if (body && (body.operation === "save-public-guide" || body.operation === "submit-public-guide")) {
        const guideId = body.guideId;
        const key = "guide:" + guideId;
        if (!isPublicGuideKey(key)) {
          return res.status(400).json({ error: "올바른 안내문 ID가 필요합니다" });
        }
        const existingResult = await redis("get", [PREFIX + key]);
        if (existingResult.result === null || existingResult.result === undefined) {
          return res.status(404).json({ error: "해당 안내문을 찾을 수 없습니다" });
        }
        const existingGuide = parseStoredGuide(existingResult.result, guideId);
        if (!existingGuide) {
          return res.status(500).json({ error: "안내문 데이터 형식이 올바르지 않습니다" });
        }
        const issueResult = await redis("get", [PREFIX + "guide-issue:" + existingGuide.clientId]);
        if (false && (issueResult.result === null || issueResult.result === undefined)) {
          return res.status(404).json({ error: "발급된 안내문을 찾을 수 없습니다" });
        }
        let reservation = null;
        try { reservation = JSON.parse(issueResult.result); } catch {}
        if (issueResult.result === null || issueResult.result === undefined) {
          reservation = { guide: existingGuide };
          await redisCommand(["SET", PREFIX + "guide-issue:" + existingGuide.clientId, JSON.stringify(reservation), "NX"]);
        } else if (
          !isValidGuideIssueReservation(reservation, existingGuide.clientId) ||
          reservation.guide.id !== guideId
        ) {
          return res.status(500).json({ error: "안내문 발급 정보가 올바르지 않습니다" });
        }
        const requestedAnswers = body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
          ? body.answers
          : {};
        const mutationResult = await redisCommand([
          "EVAL",
          PUBLIC_GUIDE_MUTATION_SCRIPT,
          2,
          PREFIX + key,
          PREFIX + "guide-issue:" + existingGuide.clientId,
          guideId,
          existingGuide.clientId,
          body.operation === "submit-public-guide" ? "1" : "0",
          JSON.stringify(requestedAnswers),
        ]);
        let mutation = null;
        try { mutation = JSON.parse(mutationResult.result); } catch {}
        if (!mutation || typeof mutation !== "object" || Array.isArray(mutation)) {
          throw new Error("PUBLIC_GUIDE_MUTATION_INVALID_RESULT");
        }
        if (mutation.status === "missing-guide") {
          return res.status(404).json({ error: "해당 안내문을 찾을 수 없습니다" });
        }
        if (mutation.status === "missing-issue") {
          return res.status(404).json({ error: "발급된 안내문을 찾을 수 없습니다" });
        }
        if (mutation.status === "too-large") {
          return res.status(413).json({ error: "저장할 데이터가 너무 큽니다" });
        }
        const guide = mutation.status === "ok"
          ? normalizeMutatedGuide(mutation.guide, guideId)
          : null;
        if (!guide || guide.clientId !== existingGuide.clientId) {
          throw new Error(`PUBLIC_GUIDE_MUTATION_${String(mutation.status || "INVALID").toUpperCase()}`);
        }
        return res.status(200).json({ guide });
      }
      if (body && body.operation === "reserve-guide-issue") {
        if (!isAuthed(req)) {
          return res.status(401).json({ error: "?몄쬆???꾩슂?⑸땲??" });
        }
        const clientId = body.clientId;
        if (typeof clientId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(clientId)) {
          return res.status(400).json({ error: "clientId ?뺤떇???щ컮瑜댁? ?딆뒿?덈떎" });
        }

        const clientResult = await redis("get", [PREFIX + "client:" + clientId]);
        if (clientResult.result === null || clientResult.result === undefined) {
          return res.status(404).json({ error: "해당 업체를 찾을 수 없습니다" });
        }
        let client = null;
        try { client = JSON.parse(clientResult.result); } catch {}
        if (!client || typeof client !== "object" || Array.isArray(client) || client.id !== clientId) {
          throw new Error("GUIDE_ISSUE_CLIENT_INVALID");
        }

        const issueKey = PREFIX + "guide-issue:" + clientId;
        const candidate = newGuideIssueReservation(clientId, client.service);
        const created = await redisCommand(["SET", issueKey, JSON.stringify(candidate), "NX"]);
        let reservation = candidate;
        if (created.result !== "OK") {
          const existingResult = await redis("get", [issueKey]);
          try { reservation = JSON.parse(existingResult.result); } catch { reservation = null; }
        }
        if (!isValidGuideIssueReservation(reservation, clientId)) {
          throw new Error("GUIDE_ISSUE_RESERVATION_INVALID");
        }
        const guideKey = PREFIX + "guide:" + reservation.guide.id;
        const guideCreated = await redisCommand(["SET", guideKey, JSON.stringify(reservation.guide), "NX"]);
        if (guideCreated.result !== "OK") {
          const storedGuideResult = await redis("get", [guideKey]);
          const storedGuide = parseStoredGuide(storedGuideResult.result, reservation.guide.id);
          if (!storedGuide || storedGuide.clientId !== clientId) {
            // A previous interrupted issuance may have left a malformed document
            // under the permanent reservation. Keep the same ID and repair only
            // that invalid document so the link remains stable.
            await redis("set", [guideKey], JSON.stringify(reservation.guide));
          } else {
            reservation = { guide: storedGuide };
          }
        }
        return res.status(200).json({ reservation, created: created.result === "OK" });
      }
      const { key, value } = body || {};
      if (!isAuthed(req)) {
        return res.status(401).json({ error: "인증이 필요합니다" });
      }
      if (!key || typeof value !== "string") {
        return res.status(400).json({ error: "key와 문자열 value가 필요합니다" });
      }
      const storedValue = isPublicGuideKey(key) ? sanitizePublicGuideValue(value) : value;
      if (storedValue === null) {
        return res.status(400).json({ error: "안내문 데이터 형식이 올바르지 않습니다" });
      }
      if (storedValue.length > 2_000_000) {
        return res.status(413).json({ error: "저장할 데이터가 너무 큽니다" });
      }
      await redis("set", [PREFIX + key], storedValue);
      return res.status(200).json({ key, value: storedValue });
    }

    if (method === "DELETE") {
      if (!isAuthed(req)) return res.status(401).json({ error: "인증이 필요합니다" });
      const key = req.query.key;
      if (!key) return res.status(400).json({ error: "key가 필요합니다" });
      await redis("del", [PREFIX + key]);
      return res.status(200).json({ key, deleted: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "허용되지 않은 메서드입니다" });
  } catch (err) {
    if (String(err.message).includes("REDIS_NOT_CONFIGURED")) {
      return res.status(500).json({
        error: "Redis가 연결되지 않았습니다. Vercel Marketplace에서 Upstash Redis를 프로젝트에 연결해 주세요.",
      });
    }
    console.error(err);
    return res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
};
