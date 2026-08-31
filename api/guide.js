const dataApi = require("./data.js");
const MAX_REQUEST_BYTES = 2_000_000;

function responseProxy(res) {
  return {
    setHeader(name, value) { res.setHeader(name, value); },
    status(code) { res.status(code); return this; },
    json(body) { return res.json(body); },
  };
}

module.exports = async function guideApi(req, res) {
  const id = req.query && req.query.id;
  if (typeof id !== "string" || !/^guide_[A-Za-z0-9_-]{24,}$/.test(id)) {
    return res.status(400).json({ error: "올바른 안내문 ID가 필요합니다" });
  }
  const action = req.query && req.query.action;
  if (req.method === "GET") {
    return dataApi({ method: "GET", headers: req.headers || {}, query: { key: `guide:${id}` } }, responseProxy(res));
  }
  if (req.method === "POST" && (action === "save" || action === "submit")) {
    let body = req.body;
    if (typeof body === "string") {
      if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
        return res.status(413).json({ error: "저장할 데이터가 너무 큽니다" });
      }
      try { body = JSON.parse(body); } catch {
        return res.status(400).json({ error: "안내문 입력값이 올바르지 않습니다" });
      }
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({ error: "안내문 입력값이 올바르지 않습니다" });
    }
    return dataApi({
      method: "POST",
      headers: req.headers || {},
      body: {
        operation: action === "submit" ? "submit-public-guide" : "save-public-guide",
        guideId: id,
        answers: body && body.answers,
        idempotencyKey: body && body.idempotencyKey,
      },
    }, responseProxy(res));
  }
  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "허용되지 않는 요청입니다" });
};
