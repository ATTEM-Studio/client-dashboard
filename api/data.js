// /api/data.js — Upstash Redis(REST) 기반 데이터 저장소
//
// 필요한 환경변수 (Vercel Marketplace에서 Upstash Redis 연결 시 자동 주입):
//   KV_REST_API_URL, KV_REST_API_TOKEN
// 직접 설정해야 하는 환경변수:
//   TEAM_PASSWORD  — 팀원이 대시보드에 접속할 때 입력하는 공용 비밀번호

const crypto = require("crypto");
const { isAuthenticated } = require("./_session");

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

const MAX_PUBLIC_STRING_LENGTH = 20_000;
const MAX_PUBLIC_SIGNATURE_LENGTH = 1_500_000;
const MAX_REQUEST_BYTES = 2_000_000;
const MAX_COLLECTION_ITEMS = 200;
const MAX_CHECKLIST_ITEMS = MAX_COLLECTION_ITEMS;
const MAX_INDEX_ITEMS = MAX_COLLECTION_ITEMS;
const MAX_REPORT_ROWS = MAX_COLLECTION_ITEMS;
const MAX_CHECKLIST_SETS = MAX_COLLECTION_ITEMS;
const MAX_PUBLIC_LIST_ITEMS = MAX_COLLECTION_ITEMS;
const MAX_PUBLIC_CHANNELS = 50;
const MAX_PUBLIC_METRICS_PER_CHANNEL = 100;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Infinity;
  }
}

function rejectLargeBody(res, value, maximum = MAX_REQUEST_BYTES) {
  if (jsonSize(value) <= maximum) return false;
  res.status(413).json({ error: "저장할 데이터가 너무 큽니다" });
  return true;
}

function rawBodySize(value) {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : jsonSize(value);
}

function rejectInvalidBody(res, message = "저장할 데이터 형식이 올바르지 않습니다") {
  res.status(400).json({ error: message });
  return true;
}

function hasOnlyBoundedStrings(value, maximum = MAX_PUBLIC_STRING_LENGTH, depth = 0) {
  if (depth > 6) return false;
  if (typeof value === "string") return value.length <= maximum;
  if (value === null || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every((item) => hasOnlyBoundedStrings(item, maximum, depth + 1));
  if (!isPlainObject(value)) return false;
  return Object.values(value).every((item) => hasOnlyBoundedStrings(item, maximum, depth + 1));
}

function isBoundedArray(value, maximum) {
  return Array.isArray(value) && value.length <= maximum;
}

function isIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isChecklistItem(value) {
  return isPlainObject(value) && isIdentifier(value.id) && typeof value.text === "string" &&
    value.text.length <= MAX_PUBLIC_STRING_LENGTH &&
    (!Object.prototype.hasOwnProperty.call(value, "week") || typeof value.week === "string") &&
    (!Object.prototype.hasOwnProperty.call(value, "done") || typeof value.done === "boolean");
}

function isChecklistSetItem(value) {
  return isPlainObject(value) && typeof value.text === "string" && value.text.length <= MAX_PUBLIC_STRING_LENGTH &&
    (!Object.prototype.hasOwnProperty.call(value, "day") || Number.isInteger(value.day));
}

function isMetric(value) {
  return isPlainObject(value) && Object.values(value).every((field) =>
    typeof field === "string" && field.length <= MAX_PUBLIC_STRING_LENGTH);
}

function isIndexEntry(value) {
  return isPlainObject(value) && isIdentifier(value.id) && Object.values(value).every((field) =>
    field === undefined || hasOnlyBoundedStrings(field));
}

function parseBoundedIndex(value, key) {
  if (value === null || value === undefined) return [];
  let index;
  try { index = JSON.parse(value); } catch { return null; }
  return validateStoredDocument(key, JSON.stringify(index)) ? index : null;
}

function upsertBoundedIndex(index, entry) {
  if (!Array.isArray(index) || !isIndexEntry(entry)) return null;
  const next = index.filter((item) => item && item.id !== entry.id);
  if (next.length >= MAX_INDEX_ITEMS) return null;
  next.push(entry);
  return next;
}

function validatePublicGuideAnswers(value) {
  if (!isPlainObject(value)) return null;
  const answers = {};
  for (const field of PUBLIC_GUIDE_ANSWER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    if (typeof value[field] !== "string" || value[field].length > MAX_PUBLIC_STRING_LENGTH) return null;
    answers[field] = value[field];
  }
  return answers;
}

function validatePublicContractInput(value) {
  if (!isPlainObject(value)) return false;
  for (const field of PUBLIC_CONTRACT_CUSTOMER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    const maximum = field === "signatureDataUrl" ? MAX_PUBLIC_SIGNATURE_LENGTH : MAX_PUBLIC_STRING_LENGTH;
    if (typeof value[field] !== "string" || value[field].length > maximum) return false;
  }
  return true;
}

function validateStoredDocument(key, value) {
  let document;
  try { document = JSON.parse(value); } catch { return false; }
  if (key.startsWith("contract:")) {
    if (!isPlainObject(document)) return false;
    if (Object.prototype.hasOwnProperty.call(document, "signatureDataUrl") &&
        (typeof document.signatureDataUrl !== "string" || document.signatureDataUrl.length > MAX_PUBLIC_SIGNATURE_LENGTH)) return false;
    const withoutSignature = Object.assign({}, document);
    delete withoutSignature.signatureDataUrl;
    return hasOnlyBoundedStrings(withoutSignature);
  }
  if (key.startsWith("guide:")) {
    const guideId = key.slice("guide:".length);
    if (!isPlainObject(document) || document.id !== guideId || !isIdentifier(document.clientId) ||
        !Number.isFinite(document.createdAt) || !Number.isFinite(document.updatedAt) ||
        (document.submittedAt !== null && !Number.isFinite(document.submittedAt)) || !isPlainObject(document.answers)) return false;
    return Object.entries(document.answers).every(([field, answer]) =>
      PUBLIC_GUIDE_ANSWER_FIELDS.includes(field) && typeof answer === "string" && answer.length <= MAX_PUBLIC_STRING_LENGTH);
  }
  if (!hasOnlyBoundedStrings(document)) return false;
  if (key.startsWith("client:")) {
    return isPlainObject(document) &&
      isIdentifier(document.id) &&
      (!Object.prototype.hasOwnProperty.call(document, "checklist") || (isBoundedArray(document.checklist, MAX_CHECKLIST_ITEMS) && document.checklist.every(isChecklistItem))) &&
      (!Object.prototype.hasOwnProperty.call(document, "renewals") || isBoundedArray(document.renewals, MAX_PUBLIC_LIST_ITEMS));
  }
  if (key.startsWith("report:")) {
    if (!isPlainObject(document)) return false;
    for (const field of ["actions_done", "facts", "interpretations", "tests", "results", "next_week"]) {
      if (Object.prototype.hasOwnProperty.call(document, field) && !isBoundedArray(document[field], MAX_PUBLIC_LIST_ITEMS)) return false;
    }
    if (Object.prototype.hasOwnProperty.call(document, "channels")) {
      if (!isBoundedArray(document.channels, MAX_PUBLIC_CHANNELS)) return false;
      if (document.channels.some((channel) => !isPlainObject(channel) || typeof channel.name !== "string" ||
          !isBoundedArray(channel.metrics, MAX_PUBLIC_METRICS_PER_CHANNEL) || !channel.metrics.every(isMetric))) return false;
    }
    if (Object.prototype.hasOwnProperty.call(document, "next")) {
      if (!isPlainObject(document.next) || ["keep", "fix", "stop", "scale"].some((field) =>
          Object.prototype.hasOwnProperty.call(document.next, field) && !isBoundedArray(document.next[field], MAX_REPORT_ROWS))) return false;
    }
    return true;
  }
  if (key === "checklist-sets") {
    return isBoundedArray(document, MAX_CHECKLIST_SETS) && document.every((set) =>
      isPlainObject(set) && isIdentifier(set.id) && typeof set.name === "string" &&
      (!Object.prototype.hasOwnProperty.call(set, "items") || (isBoundedArray(set.items, MAX_CHECKLIST_ITEMS) && set.items.every(isChecklistSetItem))));
  }
  if (["clients-index", "reports-index", "contracts-index"].includes(key)) {
    return isBoundedArray(document, MAX_INDEX_ITEMS) && document.every(isIndexEntry);
  }
  return true;
}

function publicString(value, maximum = MAX_PUBLIC_STRING_LENGTH) {
  return typeof value === "string" && value.length <= maximum ? value : undefined;
}

function publicFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function copyPublicStringList(value) {
  if (!Array.isArray(value) || value.length > MAX_PUBLIC_LIST_ITEMS) return undefined;
  const out = [];
  for (const item of value) {
    const safe = publicString(item);
    if (safe !== undefined) out.push(safe);
  }
  return out;
}

function copyPublicReport(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const out = {};
  const stringFields = [
    "id", "type", "client", "clientId", "period", "goal", "external", "uncertain", "memo", "deliveryMemo",
  ];
  const listFields = ["actions_done", "facts", "interpretations", "tests", "results", "next_week"];
  for (const field of stringFields) {
    const value = publicString(source[field]);
    if (value !== undefined) out[field] = value;
  }
  for (const field of ["createdAt", "updatedAt"]) {
    const value = publicFiniteNumber(source[field]);
    if (value !== undefined) out[field] = value;
  }
  for (const field of listFields) {
    const value = copyPublicStringList(source[field]);
    if (value !== undefined) out[field] = value;
  }
  if (source.next && typeof source.next === "object" && !Array.isArray(source.next)) {
    const next = {};
    for (const field of ["keep", "fix", "stop", "scale"]) {
      const value = copyPublicStringList(source.next[field]);
      if (value !== undefined) next[field] = value;
    }
    if (Object.keys(next).length) out.next = next;
  }
  if (source.revenue && typeof source.revenue === "object" && !Array.isArray(source.revenue)) {
    const revenue = {};
    for (const field of ["weekly", "previousMonth", "monthlyOverride", "weeklyTotal"]) {
      const value = publicFiniteNumber(source.revenue[field]);
      if (value !== undefined) revenue[field] = value;
    }
    if (Object.keys(revenue).length) out.revenue = revenue;
  }
  if (Array.isArray(source.channels) && source.channels.length <= MAX_PUBLIC_CHANNELS) {
    const channels = [];
    for (const sourceChannel of source.channels) {
      if (!sourceChannel || typeof sourceChannel !== "object" || Array.isArray(sourceChannel) ||
          !Array.isArray(sourceChannel.metrics) || sourceChannel.metrics.length > MAX_PUBLIC_METRICS_PER_CHANNEL) continue;
      const channel = {};
      const name = publicString(sourceChannel.name);
      if (name !== undefined) channel.name = name;
      const metrics = [];
      for (const sourceMetric of sourceChannel.metrics) {
        if (!sourceMetric || typeof sourceMetric !== "object" || Array.isArray(sourceMetric)) continue;
        const metric = {};
        for (const field of ["label", "value", "unit", "compareValue", "compareLabel"]) {
          const value = publicString(sourceMetric[field]);
          if (value !== undefined) metric[field] = value;
        }
        metrics.push(metric);
      }
      channel.metrics = metrics;
      channels.push(channel);
    }
    out.channels = channels;
  }
  return out;
}

function sanitizePublicReportValue(value) {
  try {
    const sanitized = copyPublicReport(JSON.parse(value));
    return sanitized ? JSON.stringify(sanitized) : null;
  } catch {
    return null;
  }
}

const PUBLIC_GUIDE_FIELDS = ["id", "clientId", "createdAt", "updatedAt", "submittedAt", "serviceContext", "answers"];
const PUBLIC_GUIDE_ANSWER_FIELDS = [
  "concern", "goal", "priorityMenu", "currentCustomers", "desiredCustomers", "strengths",
  "story", "contentTone", "avoidExpressions", "materialStatus", "approverName",
  "approverContact", "operatingNotes",
];

const PUBLIC_GUIDE_MUTATION_SCRIPT = `
if ARGV[3] == "1" then
  local prior = redis.call("GET", KEYS[3])
  if prior then return prior end
end
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
local result = cjson.encode({ status = "ok", guide = mergedGuide })
if ARGV[3] == "1" then redis.call("SET", KEYS[3], result) end
return result
`;

const PUBLIC_CONTRACT_FIELDS = [
  "id", "clientId", "clientName", "contractType", "renewalCount", "productType", "productName",
  "supplyPrice", "paymentMethod", "businessNumber", "contact", "email", "startDate",
  "contractMonths", "fee", "terms", "specialTerms", "baseTerms", "signerName",
  "signatureDataUrl", "createdAt", "updatedAt", "submittedAt",
];
const PUBLIC_CONTRACT_CUSTOMER_FIELDS = [
  "businessNumber", "contact", "email", "signerName", "signatureDataUrl",
];

const CONTRACT_SUBMIT_MUTATION_SCRIPT = `
local prior = redis.call("GET", KEYS[5])
if prior then return prior end
redis.call("SET", KEYS[1], ARGV[1])
redis.call("SET", KEYS[2], ARGV[2])
redis.call("SET", KEYS[3], ARGV[3])
redis.call("SET", KEYS[4], ARGV[4])
local result = cjson.encode({ status = "ok", contract = cjson.decode(ARGV[1]) })
redis.call("SET", KEYS[5], result)
return result
`;

const RENEWAL_MUTATION_SCRIPT = `
local prior = redis.call("GET", KEYS[3])
if prior then return prior end
redis.call("SET", KEYS[1], ARGV[1])
redis.call("SET", KEYS[2], ARGV[2])
local result = cjson.encode({ status = "ok", client = cjson.decode(ARGV[1]) })
redis.call("SET", KEYS[3], result)
return result
`;

const DELETE_REPORT_MUTATION_SCRIPT = `
local prior = redis.call("GET", KEYS[3])
if prior then return prior end
redis.call("DEL", KEYS[1])
redis.call("SET", KEYS[2], ARGV[1])
local result = cjson.encode({ status = "ok" })
redis.call("SET", KEYS[3], result)
return result
`;

const DELETE_CLIENT_MUTATION_SCRIPT = `
local prior = redis.call("GET", KEYS[4])
if prior then return prior end
for index = 5, #KEYS do redis.call("DEL", KEYS[index]) end
redis.call("DEL", KEYS[1])
redis.call("SET", KEYS[2], ARGV[1])
redis.call("SET", KEYS[3], ARGV[2])
local result = cjson.encode({ status = "ok" })
redis.call("SET", KEYS[4], result)
return result
`;

function validIdempotencyKey(value) {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{8,200}$/.test(value);
}

function sanitizePublicContractObject(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  if (typeof source.id !== "string" || !/^contract_[A-Za-z0-9_-]{24,}$/.test(source.id)) return null;
  const out = {};
  for (const field of PUBLIC_CONTRACT_FIELDS) {
    const maximum = field === "signatureDataUrl" ? MAX_PUBLIC_SIGNATURE_LENGTH : MAX_PUBLIC_STRING_LENGTH;
    const string = publicString(source[field], maximum);
    const number = publicFiniteNumber(source[field]);
    if (string !== undefined) out[field] = string;
    else if (number !== undefined) out[field] = number;
    else if (field === "submittedAt" && source[field] === null) out[field] = null;
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
      const string = publicString(source[field]);
      const number = publicFiniteNumber(source[field]);
      if (string !== undefined) sanitized[field] = string;
      else if (number !== undefined) sanitized[field] = number;
      else if (field === "submittedAt" && source[field] === null) sanitized[field] = null;
    }
    const answers = source.answers && typeof source.answers === "object" && !Array.isArray(source.answers)
      ? source.answers
      : {};
    sanitized.answers = {};
    for (const field of PUBLIC_GUIDE_ANSWER_FIELDS) {
      const answer = publicString(answers[field]);
      if (answer !== undefined) sanitized.answers[field] = answer;
    }
    return JSON.stringify(sanitized);
  } catch {
    return null;
  }
}

function parseStoredGuide(value, guideId) {
  try {
    const guide = JSON.parse(value);
    if (guide.submittedAt === undefined) guide.submittedAt = null;
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
    const method = req.method;

    if (method === "GET") {
      const key = req.query.key;
      if (!key) return res.status(400).json({ error: "key가 필요합니다" });
      const authenticated = isAuthenticated(req);
      if (!authenticated && !isPublicReadable(key)) {
        return res.status(401).json({ error: "인증이 필요합니다" });
      }
      const out = await redis("get", [PREFIX + key]);
      if (out.result === null || out.result === undefined) {
        return res.status(404).json({ error: "해당 키를 찾을 수 없습니다" });
      }
      if (!authenticated && isPublicGuideKey(key)) {
        const guideId = key.slice("guide:".length);
        const storedGuide = parseStoredGuide(out.result, guideId);
        const value = storedGuide ? sanitizePublicGuideValue(JSON.stringify(storedGuide)) : null;
        if (value === null) return res.status(500).json({ error: "안내문 데이터 형식이 올바르지 않습니다" });
        return res.status(200).json({ key, value });
      }
      if (!authenticated && isPublicContractKey(key)) {
        const value = sanitizePublicContractValue(out.result);
        if (value === null) return res.status(500).json({ error: "계약서 데이터 형식이 올바르지 않습니다" });
        return res.status(200).json({ key, value });
      }
      if (!authenticated && key.startsWith("report:")) {
        const value = sanitizePublicReportValue(out.result);
        if (value === null) return res.status(500).json({ error: "리포트 데이터 형식이 올바르지 않습니다" });
        return res.status(200).json({ key, value });
      }
      return res.status(200).json({ key, value: out.result });
    }

    if (method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        if (rawBodySize(body) > MAX_REQUEST_BYTES) return rejectLargeBody(res, body);
        try { body = JSON.parse(body); } catch { return rejectInvalidBody(res); }
      }
      if (!isPlainObject(body)) return rejectInvalidBody(res);
      if (rejectLargeBody(res, body)) return;
      if (body && (body.operation === "save-public-contract" || body.operation === "submit-public-contract")) {
        const contractId = body.contractId;
        const key = "contract:" + contractId;
        if (!isPublicContractKey(key)) {
          return res.status(400).json({ error: "올바른 계약서 ID가 필요합니다" });
        }
        if (isPlainObject(body.contract) && typeof body.contract.signatureDataUrl === "string" &&
            body.contract.signatureDataUrl.length > MAX_PUBLIC_SIGNATURE_LENGTH) {
          return res.status(413).json({ error: "저장할 데이터가 너무 큽니다" });
        }
        if (!validatePublicContractInput(body.contract)) {
          return res.status(400).json({ error: "계약서 입력값이 올바르지 않습니다" });
        }
        const existingResult = await redis("get", [PREFIX + key]);
        if (existingResult.result === null || existingResult.result === undefined) {
          return res.status(404).json({ error: "계약서를 찾을 수 없습니다" });
        }
        let storedContract = null;
        try { storedContract = JSON.parse(existingResult.result); } catch {}
        const existing = sanitizePublicContractObject(storedContract);
        if (!existing || existing.id !== contractId) {
          return res.status(500).json({ error: "계약서 데이터 형식이 올바르지 않습니다" });
        }
        if (body.operation === "submit-public-contract" && body.idempotencyKey !== undefined && !validIdempotencyKey(body.idempotencyKey)) {
          return res.status(400).json({ error: "중복 방지 키 형식이 올바르지 않습니다" });
        }
        const requested = sanitizePublicContractObject(Object.assign({}, body.contract || {}, { id: contractId }));
        if (!requested) return res.status(400).json({ error: "계약서 입력값이 올바르지 않습니다" });
        const fullContract = Object.assign({}, storedContract);
        if (!(body.operation === "submit-public-contract" && storedContract.submittedAt)) {
          for (const field of PUBLIC_CONTRACT_CUSTOMER_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(requested, field)) fullContract[field] = requested[field];
          }
        }
        fullContract.updatedAt = storedContract.submittedAt || Date.now();
        if (body.operation === "submit-public-contract" && !fullContract.submittedAt) {
          fullContract.submittedAt = fullContract.updatedAt;
        }
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
          const clientsIndexResult = await redis("get", [PREFIX + "clients-index"]).catch(() => ({ result: null }));
          const clientsIndex = upsertBoundedIndex(parseBoundedIndex(clientsIndexResult.result, "clients-index"),
            { id: client.id, name: client.name, contractType: client.contractType, renewalCount: client.renewalCount, startDate: client.startDate, status: client.status, updatedAt: client.updatedAt });
          const contractsIndexResult = await redis("get", [PREFIX + "contracts-index"]).catch(() => ({ result: null }));
          const contractsIndex = upsertBoundedIndex(parseBoundedIndex(contractsIndexResult.result, "contracts-index"),
            { id: fullContract.id, clientId: fullContract.clientId, clientName: fullContract.clientName || "계약서 작성 대기", contractType: fullContract.contractType, renewalCount: fullContract.renewalCount, productName: fullContract.productName, startDate: fullContract.startDate, contractMonths: fullContract.contractMonths, fee: fullContract.fee, signerName: fullContract.signerName, submittedAt: fullContract.submittedAt, hasSignature: !!fullContract.signatureDataUrl, updatedAt: fullContract.updatedAt });
          if (!clientsIndex || !contractsIndex) return res.status(400).json({ error: "계약서 목록이 너무 크거나 형식이 올바르지 않습니다" });
          const mutationResult = await redisCommand(["EVAL", CONTRACT_SUBMIT_MUTATION_SCRIPT, 5,
            PREFIX + key, PREFIX + "client:" + client.id, PREFIX + "clients-index", PREFIX + "contracts-index",
            PREFIX + "idempotency:contract:" + contractId + ":" + (body.idempotencyKey || "contract-submit:" + contractId),
            JSON.stringify(fullContract), JSON.stringify(client), JSON.stringify(clientsIndex), JSON.stringify(contractsIndex)]);
          let mutation = null;
          try { mutation = JSON.parse(mutationResult.result); } catch {}
          if (!mutation || mutation.status !== "ok") throw new Error("CONTRACT_SUBMIT_MUTATION_INVALID_RESULT");
          return res.status(200).json({ contract: sanitizePublicContractObject(mutation.contract) });
        }
        const contractsIndexResult = await redis("get", [PREFIX + "contracts-index"]).catch(() => ({ result: null }));
        const contractsIndex = upsertBoundedIndex(parseBoundedIndex(contractsIndexResult.result, "contracts-index"),
          { id: fullContract.id, clientId: fullContract.clientId, clientName: fullContract.clientName || "계약서 작성 대기", contractType: fullContract.contractType, renewalCount: fullContract.renewalCount, productName: fullContract.productName, startDate: fullContract.startDate, contractMonths: fullContract.contractMonths, fee: fullContract.fee, signerName: fullContract.signerName, submittedAt: fullContract.submittedAt, hasSignature: !!fullContract.signatureDataUrl, updatedAt: fullContract.updatedAt });
        if (!contractsIndex) return res.status(400).json({ error: "계약서 목록이 너무 크거나 형식이 올바르지 않습니다" });
        await redis("set", [PREFIX + key], JSON.stringify(fullContract));
        await redis("set", [PREFIX + "contracts-index"], JSON.stringify(contractsIndex));
        return res.status(200).json({ contract: sanitizePublicContractObject(fullContract) });
      }
      if (body && (body.operation === "save-public-guide" || body.operation === "submit-public-guide")) {
        const guideId = body.guideId;
        const key = "guide:" + guideId;
        if (!isPublicGuideKey(key)) {
          return res.status(400).json({ error: "올바른 안내문 ID가 필요합니다" });
        }
        const requestedAnswers = validatePublicGuideAnswers(body.answers);
        if (requestedAnswers === null) {
          return res.status(400).json({ error: "안내문 입력값이 올바르지 않습니다" });
        }
        if (body.operation === "submit-public-guide" && body.idempotencyKey !== undefined && !validIdempotencyKey(body.idempotencyKey)) {
          return res.status(400).json({ error: "중복 방지 키 형식이 올바르지 않습니다" });
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
        const mutationResult = await redisCommand([
          "EVAL",
          PUBLIC_GUIDE_MUTATION_SCRIPT,
          3,
          PREFIX + key,
          PREFIX + "guide-issue:" + existingGuide.clientId,
          PREFIX + "idempotency:guide:" + guideId + ":" + (body.idempotencyKey || "guide-submit:" + guideId),
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
        if (!isAuthenticated(req)) {
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
      if (body && body.operation === "renew-client") {
        if (!isAuthenticated(req)) return res.status(401).json({ error: "인증이 필요합니다" });
        if (!isIdentifier(body.clientId) || !validIdempotencyKey(body.idempotencyKey) ||
            !isPlainObject(body.client) || !Array.isArray(body.clientsIndex) ||
            body.client.id !== body.clientId ||
            !validateStoredDocument("client:" + body.clientId, JSON.stringify(body.client)) ||
            !validateStoredDocument("clients-index", JSON.stringify(body.clientsIndex))) {
          return res.status(400).json({ error: "재계약 입력값이 올바르지 않습니다" });
        }
        const mutationResult = await redisCommand(["EVAL", RENEWAL_MUTATION_SCRIPT, 3,
          PREFIX + "client:" + body.clientId, PREFIX + "clients-index",
          PREFIX + "idempotency:renewal:" + body.clientId + ":" + body.idempotencyKey,
          JSON.stringify(body.client), JSON.stringify(body.clientsIndex)]);
        let mutation = null;
        try { mutation = JSON.parse(mutationResult.result); } catch {}
        if (!mutation || mutation.status !== "ok" || !isPlainObject(mutation.client)) throw new Error("RENEWAL_MUTATION_INVALID_RESULT");
        return res.status(200).json({ client: mutation.client });
      }
      if (body && body.operation === "delete-report") {
        if (!isAuthenticated(req)) return res.status(401).json({ error: "인증이 필요합니다" });
        if (!isIdentifier(body.reportId) || !validIdempotencyKey(body.idempotencyKey) ||
            !validateStoredDocument("reports-index", JSON.stringify(body.reportsIndex))) {
          return res.status(400).json({ error: "리포트 삭제 입력값이 올바르지 않습니다" });
        }
        const mutationResult = await redisCommand(["EVAL", DELETE_REPORT_MUTATION_SCRIPT, 3,
          PREFIX + "report:" + body.reportId, PREFIX + "reports-index",
          PREFIX + "idempotency:delete-report:" + body.reportId + ":" + body.idempotencyKey,
          JSON.stringify(body.reportsIndex)]);
        let mutation = null;
        try { mutation = JSON.parse(mutationResult.result); } catch {}
        if (!mutation || mutation.status !== "ok") throw new Error("DELETE_REPORT_MUTATION_INVALID_RESULT");
        return res.status(200).json({ deleted: true });
      }
      if (body && body.operation === "delete-client") {
        if (!isAuthenticated(req)) return res.status(401).json({ error: "인증이 필요합니다" });
        if (!isIdentifier(body.clientId) || !validIdempotencyKey(body.idempotencyKey) ||
            !Array.isArray(body.reportIds) || body.reportIds.length > MAX_INDEX_ITEMS || !body.reportIds.every(isIdentifier) ||
            !validateStoredDocument("reports-index", JSON.stringify(body.reportsIndex)) ||
            !validateStoredDocument("clients-index", JSON.stringify(body.clientsIndex))) {
          return res.status(400).json({ error: "업체 삭제 입력값이 올바르지 않습니다" });
        }
        const mutationResult = await redisCommand(["EVAL", DELETE_CLIENT_MUTATION_SCRIPT, 4 + body.reportIds.length,
          PREFIX + "client:" + body.clientId, PREFIX + "reports-index", PREFIX + "clients-index",
          PREFIX + "idempotency:delete-client:" + body.clientId + ":" + body.idempotencyKey,
          ...body.reportIds.map((id) => PREFIX + "report:" + id), JSON.stringify(body.reportsIndex), JSON.stringify(body.clientsIndex)]);
        let mutation = null;
        try { mutation = JSON.parse(mutationResult.result); } catch {}
        if (!mutation || mutation.status !== "ok") throw new Error("DELETE_CLIENT_MUTATION_INVALID_RESULT");
        return res.status(200).json({ deleted: true });
      }
      const { key, value } = body || {};
      if (!isAuthenticated(req)) {
        return res.status(401).json({ error: "인증이 필요합니다" });
      }
      if (!key || typeof value !== "string") {
        return res.status(400).json({ error: "key와 문자열 value가 필요합니다" });
      }
      if (typeof key !== "string" || key.length > 256) {
        return res.status(400).json({ error: "key 형식이 올바르지 않습니다" });
      }
      const storedValue = isPublicGuideKey(key) ? sanitizePublicGuideValue(value) : value;
      if (storedValue === null) {
        return res.status(400).json({ error: "안내문 데이터 형식이 올바르지 않습니다" });
      }
      if (storedValue.length > 2_000_000) {
        return res.status(413).json({ error: "저장할 데이터가 너무 큽니다" });
      }
      if (!validateStoredDocument(key, storedValue)) {
        return res.status(400).json({ error: "저장할 데이터 형식이 올바르지 않습니다" });
      }
      await redis("set", [PREFIX + key], storedValue);
      return res.status(200).json({ key, value: storedValue });
    }

    if (method === "DELETE") {
      if (!isAuthenticated(req)) return res.status(401).json({ error: "인증이 필요합니다" });
      const key = req.query.key;
      if (!key) return res.status(400).json({ error: "key가 필요합니다" });
      if (key.startsWith("report:") || key.startsWith("client:")) {
        return res.status(400).json({ error: "이 데이터는 원자적 삭제 요청이 필요합니다" });
      }
      await redis("del", [PREFIX + key]);
      return res.status(200).json({ key, deleted: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "허용되지 않은 메서드입니다" });
  } catch (err) {
    if (String(err.message).includes("REDIS_NOT_CONFIGURED")) {
      return res.status(503).json({ error: "서비스를 일시적으로 사용할 수 없습니다" });
    }
    return res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
};
