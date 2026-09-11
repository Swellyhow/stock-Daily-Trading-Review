import express from "express";

const router = express.Router();
const DEFAULT_BRIDGE_URL = "http://127.0.0.1:7897";

function bridgeUrl() {
  return String(process.env.CMES_BRIDGE_URL || DEFAULT_BRIDGE_URL).replace(/\/$/, "");
}

function security(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (/^(SH|SZ|BJ)\.\d{6}$/.test(raw)) return raw;
  if (/^\d{6}$/.test(raw)) return /^(6|68|5|9)/.test(raw) ? `SH.${raw}` : /^(4|8|92)/.test(raw) ? `BJ.${raw}` : `SZ.${raw}`;
  return "";
}

async function bridgeGet(pathname, params = {}) {
  const url = new URL(`${bridgeUrl()}${pathname}`);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CMES_TIMEOUT_MS || 15000));
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `CMES 桥接服务 HTTP ${response.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

router.get("/api/cmes/status", async (_req, res) => {
  try {
    const body = await bridgeGet("/health", { probe: "1" });
    const ready = body.logged_in === true;
    res.status(ready ? 200 : 503).json({ ok: ready, bridgeUrl: bridgeUrl(), ...body, source: "CMES cmesdata VIP", ...(ready ? {} : { error: body.error || "CMES Token 未获得股票实时行情权限" }) });
  } catch (error) {
    res.status(503).json({ ok: false, bridgeUrl: bridgeUrl(), source: "CMES cmesdata VIP", error: error.message });
  }
});

router.get("/api/cmes/quotes", async (req, res) => {
  const securities = String(req.query.securities || req.query.codes || "").split(",").map(security).filter(Boolean);
  if (!securities.length) return res.status(400).json({ ok: false, error: "请提供 securities 或 codes" });
  try {
    const body = await bridgeGet("/quotes", { securities: securities.join(",") });
    res.json({ ok: true, source: "CMES cmesdata.get_real_hq", requested: securities, ...body });
  } catch (error) {
    res.status(502).json({ ok: false, source: "CMES cmesdata.get_real_hq", requested: securities, error: error.message });
  }
});

router.get("/api/cmes/ticks", async (req, res) => {
  const value = security(req.query.security || req.query.code);
  if (!value) return res.status(400).json({ ok: false, error: "security 或 code 格式不正确" });
  const count = Math.min(5000, Math.max(1, Number(req.query.count) || 2000));
  try {
    const body = await bridgeGet("/ticks", { security: value, count: String(count) });
    res.json({ ok: true, source: "CMES cmesdata.get_transaction_data", ...body });
  } catch (error) {
    res.status(502).json({ ok: false, source: "CMES cmesdata.get_transaction_data", security: value, error: error.message });
  }
});

router.get("/api/cmes/minutes", async (req, res) => {
  const value = security(req.query.security || req.query.code);
  if (!value) return res.status(400).json({ ok: false, error: "security 或 code 格式不正确" });
  try {
    const body = await bridgeGet("/minutes", { security: value });
    res.json({ ok: true, source: "CMES cmesdata.get_minute_time_data", ...body });
  } catch (error) {
    res.status(502).json({ ok: false, source: "CMES cmesdata.get_minute_time_data", security: value, error: error.message });
  }
});

export default router;
