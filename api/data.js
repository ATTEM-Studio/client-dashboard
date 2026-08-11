// /api/data.js — Upstash Redis(REST) 기반 데이터 저장소
//
// 필요한 환경변수 (Vercel Marketplace에서 Upstash Redis 연결 시 자동 주입):
//   KV_REST_API_URL, KV_REST_API_TOKEN
// 직접 설정해야 하는 환경변수:
//   TEAM_PASSWORD  — 팀원이 대시보드에 접속할 때 입력하는 공용 비밀번호

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

// 리포트와 고엔트로피 안내문 링크는 인증 없이 읽기 허용
function isPublicReadable(key) {
  return typeof key === "string" && (key.startsWith("report:") || isPublicGuideKey(key));
}

function isPublicWritable(key) {
  return isPublicGuideKey(key);
}

const PUBLIC_GUIDE_FIELDS = ["id", "clientId", "createdAt", "updatedAt", "submittedAt", "answers"];
const PUBLIC_GUIDE_ANSWER_FIELDS = [
  "concern", "goal", "priorityMenu", "currentCustomers", "desiredCustomers", "strengths",
  "story", "contentTone", "avoidExpressions", "materialStatus", "approverName",
  "approverContact", "operatingNotes",
];

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
        const value = sanitizePublicGuideValue(out.result);
        if (value === null) return res.status(500).json({ error: "안내문 데이터 형식이 올바르지 않습니다" });
        return res.status(200).json({ key, value });
      }
      return res.status(200).json({ key, value: out.result });
    }

    if (method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      const { key, value } = body || {};
      if (!isAuthed(req) && !isPublicWritable(key)) {
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
