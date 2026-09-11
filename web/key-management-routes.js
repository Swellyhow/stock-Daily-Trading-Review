import express from "express";
import fs from "node:fs";
import path from "node:path";

const router = express.Router();
const projectRoot = process.cwd();
const envPath = path.join(projectRoot, ".env");

const CONFIG = Object.freeze([
  { key: "HOT_MONEY_SILICONFLOW_API_KEY", label: "硅基流动 API Key（项目）", group: "siliconflow", secret: true },
  { key: "SILICONFLOW_API_KEY", label: "硅基流动 API Key（兼容）", group: "siliconflow", secret: true },
  { key: "SILICONFLOW_REVIEW_MODEL_OVERRIDE", label: "复盘识别模型", group: "siliconflow", secret: false },
  { key: "SILICONFLOW_REVIEW_MODEL", label: "复盘模型（默认）", group: "siliconflow", secret: false },
  { key: "SILICONFLOW_MODEL_PRIMARY", label: "主模型", group: "siliconflow", secret: false },
  { key: "SILICONFLOW_MODEL_BACKUP", label: "备用模型", group: "siliconflow", secret: false },
  { key: "SILICONFLOW_BASE_URL", label: "硅基流动地址", group: "siliconflow", secret: false },
  { key: "SILICONFLOW_REVIEW_TIMEOUT_MS", label: "复盘超时（毫秒）", group: "siliconflow", secret: false },
  { key: "SILICONFLOW_REVIEW_MAX_TOKENS", label: "复盘最大输出 Token", group: "siliconflow", secret: false },
  { key: "LLM_API_KEY", label: "通用 LLM API Key", group: "llm", secret: true },
  { key: "OPENAI_API_KEY", label: "OpenAI API Key（兼容）", group: "llm", secret: true },
  { key: "TIANAPI_KEY", label: "天行数据 API Key（兼容）", group: "llm", secret: true },
  { key: "MX_APIKEY", label: "妙想 API Key", group: "miaoxiang", secret: true },
  { key: "MX_API_URL", label: "妙想服务地址", group: "miaoxiang", secret: false },
  { key: "IFIND_MCP_TOKEN", label: "iFinD Token", group: "ifind", secret: true },
  { key: "IFIND_MCP_KEY", label: "iFinD Token（兼容）", group: "ifind", secret: true },
  { key: "IFIND_API_KEY", label: "iFinD API Key（兼容）", group: "ifind", secret: true },
  { key: "IFIND_MCP_URL", label: "iFinD 股票服务地址", group: "ifind", secret: false },
  { key: "IFIND_INDEX_MCP_URL", label: "iFinD 指数服务地址", group: "ifind", secret: false },
  { key: "IFIND_MCP_TIMEOUT_MS", label: "iFinD 超时（毫秒）", group: "ifind", secret: false },
  { key: "STOCKDB_URL", label: "stockdb 地址", group: "stockdb", secret: false },
  { key: "STOCKDB_ROOT", label: "stockdb 根目录", group: "stockdb", secret: false },
  { key: "STOCKDB_CONCEPT_PATH", label: "stockdb 概念文件路径", group: "stockdb", secret: false },
  { key: "STOCKDB_PYTHON", label: "stockdb Python 命令", group: "stockdb", secret: false },
  { key: "STOCKDB_PYTHONPATH", label: "stockdb Python 路径", group: "stockdb", secret: false },
  { key: "STOCKDB_MINUTE_RETENTION_DAYS", label: "分钟线保留天数", group: "stockdb", secret: false }
  ,{ key: "CMES_TOKEN", label: "CMES VIP Token", group: "cmes", secret: true }
  ,{ key: "CMES_BRIDGE_URL", label: "CMES 桥接地址", group: "cmes", secret: false }
  ,{ key: "CMES_TIMEOUT_MS", label: "CMES 请求超时（毫秒）", group: "cmes", secret: false }
]);
const allowedKeys = new Set(CONFIG.map((item) => item.key));

function localOnly(req, res, next) {
  const address = String(req.socket?.remoteAddress || "");
  if (address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1") return next();
  return res.status(403).json({ ok: false, error: "密钥管理仅允许本机访问" });
}

function readEnvText() {
  try { return fs.readFileSync(envPath, "utf8"); } catch { return ""; }
}

function parseEnv(text) {
  const values = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || !allowedKeys.has(match[1]) || values[match[1]] !== undefined) continue;
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function mask(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return "已配置";
  return `${text.slice(0, 3)}${"*".repeat(Math.min(10, text.length - 6))}${text.slice(-3)}`;
}

function statusPayload() {
  const values = parseEnv(readEnvText());
  return CONFIG.map((item) => ({
    key: item.key,
    label: item.label,
    group: item.group,
    secret: item.secret,
    configured: Boolean(process.env[item.key] || values[item.key]),
    masked: mask(process.env[item.key] || values[item.key] || ""),
    value: item.secret ? undefined : (process.env[item.key] ?? values[item.key] ?? "")
  }));
}

async function bridgeStatus() {
  const base = String(process.env.CMES_BRIDGE_URL || "http://127.0.0.1:7897").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${base}/health`, { signal: controller.signal });
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function quoteEnvValue(value) {
  const text = String(value ?? "");
  return /[\s#"'`]/.test(text) ? JSON.stringify(text) : text;
}

function writeEnvValues(updates) {
  const original = readEnvText();
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original ? original.split(/\r?\n/) : [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || !Object.prototype.hasOwnProperty.call(updates, match[1])) continue;
    const key = match[1];
    seen.add(key);
    const value = updates[key];
    lines[i] = value ? `${key}=${quoteEnvValue(value)}` : `# ${key} removed by key management`;
  }
  for (const [key, value] of Object.entries(updates)) {
    if (seen.has(key) || !value) continue;
    lines.push(`${key}=${quoteEnvValue(value)}`);
  }
  const tempPath = `${envPath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, lines.join(newline), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tempPath, envPath);
  for (const [key, value] of Object.entries(updates)) {
    if (value) process.env[key] = value;
    else delete process.env[key];
  }
}

router.use(localOnly);

router.get("/api/key-management/status", async (_req, res) => {
  const items = statusPayload();
  const bridge = await bridgeStatus();
  const cmes = items.find((item) => item.key === "CMES_TOKEN");
  if (cmes && !cmes.configured && bridge?.token_configured) {
    cmes.configured = true;
    cmes.masked = "桥接配置已存在";
    cmes.source = "stockdb CMES 桥接";
  }
  res.json({ ok: true, items, envPath: ".env", cmesBridge: bridge ? {
    url: process.env.CMES_BRIDGE_URL || "http://127.0.0.1:7897",
    tokenConfigured: Boolean(bridge.token_configured),
    loggedIn: Boolean(bridge.logged_in),
    error: bridge.error || null
  } : null });
});

router.put("/api/key-management/config", (req, res) => {
  const input = req.body?.values;
  if (!input || typeof input !== "object" || Array.isArray(input)) return res.status(400).json({ ok: false, error: "配置格式无效" });
  const updates = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!allowedKeys.has(key)) return res.status(400).json({ ok: false, error: `不允许修改配置项：${key}` });
    if (raw !== null && typeof raw !== "string") return res.status(400).json({ ok: false, error: `${key} 必须是文本` });
    const value = String(raw ?? "").trim();
    if (value.length > 4096) return res.status(400).json({ ok: false, error: `${key} 长度超过限制` });
    if (key === "SILICONFLOW_REVIEW_TIMEOUT_MS" && value && (!/^\d+$/.test(value) || Number(value) < 30000)) return res.status(400).json({ ok: false, error: "复盘超时必须是不小于 30000 的整数" });
    if (key === "SILICONFLOW_REVIEW_MAX_TOKENS" && value && (!/^\d+$/.test(value) || Number(value) < 12000)) return res.status(400).json({ ok: false, error: "复盘最大输出 Token 必须是不小于 12000 的整数" });
    if (key === "IFIND_MCP_TIMEOUT_MS" && value && (!/^\d+$/.test(value) || Number(value) < 1000)) return res.status(400).json({ ok: false, error: "iFinD 超时必须是不小于 1000 的整数" });
    if (key === "STOCKDB_MINUTE_RETENTION_DAYS" && value && (!/^\d+$/.test(value) || Number(value) < 1)) return res.status(400).json({ ok: false, error: "分钟线保留天数必须是不小于 1 的整数" });
    if (key === "CMES_TIMEOUT_MS" && value && (!/^\d+$/.test(value) || Number(value) < 1000)) return res.status(400).json({ ok: false, error: "CMES 超时必须是不小于 1000 的整数" });
    updates[key] = value;
  }
  try {
    writeEnvValues(updates);
    res.json({ ok: true, items: statusPayload() });
  } catch (error) {
    res.status(500).json({ ok: false, error: `保存配置失败：${error.message}` });
  }
});

router.post("/api/key-management/test", async (req, res) => {
  const provider = String(req.body?.provider || "siliconflow");
  if (provider !== "siliconflow") return res.json({ ok: true, provider, message: "该数据源暂提供配置状态检查" });
  const key = process.env.HOT_MONEY_SILICONFLOW_API_KEY || process.env.SILICONFLOW_API_KEY;
  const baseUrl = String(process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1").replace(/\/$/, "");
  if (!key) return res.status(400).json({ ok: false, provider, error: "未配置硅基流动 API Key" });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: controller.signal });
    if (!response.ok) return res.status(502).json({ ok: false, provider, error: `硅基流动返回 HTTP ${response.status}` });
    const body = await response.json();
    const model = process.env.SILICONFLOW_REVIEW_MODEL_OVERRIDE || process.env.SILICONFLOW_REVIEW_MODEL || "moonshotai/Kimi-K2.7-Code";
    const available = Array.isArray(body?.data) && body.data.some((item) => item?.id === model);
    res.json({ ok: true, provider, available, model, message: available ? "连接正常，模型可用" : "连接正常，但当前模型不在返回列表中" });
  } catch (error) {
    res.status(502).json({ ok: false, provider, error: error?.name === "AbortError" ? "连接超时" : "连接失败" });
  } finally {
    clearTimeout(timer);
  }
});

export default router;
