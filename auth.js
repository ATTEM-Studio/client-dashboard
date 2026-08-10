// /api/auth.js — 팀 공용 비밀번호 확인

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "허용되지 않은 메서드입니다" });
  }

  const expected = process.env.TEAM_PASSWORD;
  if (!expected) {
    return res.status(500).json({
      error: "TEAM_PASSWORD 환경변수가 설정되지 않았습니다. Vercel 프로젝트 설정에서 추가해 주세요.",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const given = (body && body.password) || "";

  if (given !== expected) {
    return res.status(401).json({ ok: false, error: "비밀번호가 올바르지 않습니다" });
  }

  const configured = Boolean(
    (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
    (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)
  );

  return res.status(200).json({ ok: true, token: expected, redisConfigured: configured });
};
