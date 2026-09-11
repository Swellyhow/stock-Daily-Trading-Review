import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import * as cheerio from "cheerio";
import { readStockDbLimitUpReasons, readStockDbLimitUpReviewStatus, writeStockDbLimitUpReasons, writeStockDbLimitUpReviewStatus } from "./stockdb-client.js";
import { fetchThsLimitUpPool } from "./ths-auto.js";

const REVIEW_LIST_URL = "https://yuanchuang.10jqka.com.cn/mrnxgg_list/";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
function reviewTimeoutMs() { return Number(process.env.SILICONFLOW_REVIEW_TIMEOUT_MS || 600000); }

function normalizeDate(value) {
  const text = String(value ?? "").replace(/-/g, "");
  return /^\d{8}$/.test(text) ? text : "";
}

function loadEnvValue(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) if (process.env[key]) return process.env[key];
  for (const filePath of [path.resolve(process.cwd(), ".env")]) {
    if (!fs.existsSync(filePath)) continue;
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const match = line.replace(/^\uFEFF/, "").match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && list.includes(match[1])) return match[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return "";
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeStockName(value) {
  return cleanText(value).replace(/[\s*（）()\-—_]/g, "").toUpperCase();
}

function decodeRscChunks(html) {
  const chunks = [];
  const marker = "self.__next_f.push([1,";
  let cursor = 0;
  while ((cursor = html.indexOf(marker, cursor)) >= 0) {
    const start = cursor + marker.length;
    const end = html.indexOf("])<\/script>", start);
    if (end < 0) break;
    const argument = html.slice(start, end).trim();
    if (argument.startsWith('"')) {
      try {
        const value = JSON.parse(argument);
        if (typeof value === "string") chunks.push(value);
      } catch {
        // A malformed unrelated RSC chunk should not hide valid article chunks.
      }
    }
    cursor = end + 10;
  }
  return chunks.join("\n");
}

function parseReviewList(html, date) {
  const $ = cheerio.load(html);
  const normalizedDate = normalizeDate(date);
  const candidates = [];
  $("a[href]").each((_index, node) => {
    const title = cleanText($(node).attr("title") || $(node).text());
    const href = String($(node).attr("href") || "");
    const match = href.match(/\/(\d{8})\/(c\d+)\.shtml/i);
    if (!match || !/^涨停复盘/.test(title)) return;
    if (normalizedDate && match[1] !== normalizedDate) return;
    candidates.push({ date: match[1], title, url: new URL(href, REVIEW_LIST_URL).href });
  });
  return candidates[0] || null;
}

function parseArticle(html, metadata) {
  const contentHtml = decodeRscChunks(html);
  const $ = cheerio.load(contentHtml || html);
  const imageUrls = [...new Set($("img[src]").map((_index, node) => {
    const src = String($(node).attr("src") || "").trim();
    return /^https?:\/\/u\.thsi\.cn\/imgsrc\/input\/.+\.(?:png|jpe?g|webp)(?:\?.*)?$/i.test(src) ? src : "";
  }).get().filter(Boolean))];
  const paragraphs = $("p").map((_index, node) => cleanText($(node).text())).get().filter(Boolean);
  const byCode = new Map();
  $("a[data-code]").each((_index, node) => {
    const code = String($(node).attr("data-code") || "").trim();
    // 排除指数/行业板块锚点，只保留 A 股股票代码。
    if (!/^\d{6}$/.test(code) || /^(?:399|881)\d{3}$/.test(code)) return;
    const name = cleanText($(node).text());
    const parentText = cleanText($(node).closest("p").text() || $(node).parent().text());
    if (!byCode.has(code)) byCode.set(code, { code, name, contexts: [] });
    const item = byCode.get(code);
    if (parentText && !item.contexts.includes(parentText)) item.contexts.push(parentText);
  });
  const sourceText = paragraphs.join("\n");
  return {
    ...metadata,
    summary: cleanText($('meta[name="description"]').attr("content") || paragraphs[0] || ""),
    contentHtml,
    contentText: sourceText,
    imageUrls,
    candidates: [...byCode.values()].map((item) => ({ ...item, contexts: item.contexts.slice(0, 8) }))
  };
}

function parseModelJson(text) {
  const raw = String(text ?? "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Kimi 返回中没有找到 JSON 数组");
  const value = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(value)) throw new Error("Kimi 返回格式不是数组");
  return value;
}

async function readStreamingContent(response) {
  const stream = response?.data;
  if (!stream || typeof stream.on !== "function" || typeof stream[Symbol.asyncIterator] !== "function") {
    return response?.data?.choices?.[0]?.message?.content || "";
  }
  let buffer = "";
  const parts = [];
  const consumeLines = (text) => {
    const lines = text.split(/\r?\n/);
    const remainder = lines.pop() || "";
    for (const line of lines) {
      const value = line.trim();
      if (!value.startsWith("data:")) continue;
      const payload = value.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const content = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (typeof content === "string") parts.push(content);
        else if (Array.isArray(content)) parts.push(content.map((item) => item?.text || "").join(""));
      } catch {
        // Ignore keep-alive/comment frames and malformed non-content chunks.
      }
    }
    return remainder;
  };
  for await (const chunk of stream) {
    buffer += Buffer.from(chunk).toString("utf8");
    buffer = consumeLines(buffer);
  }
  // Some proxies close the stream immediately after the final JSON frame,
  // without appending a newline. Do not discard that last frame.
  if (buffer.trim()) consumeLines(`${buffer}\n`);
  return parts.join("");
}

async function extractWithKimi(article, focusCodes = []) {
  // Project-scoped alias prevents this app from sharing an ambiguous global
  // SILICONFLOW_API_KEY with other local projects.
  const apiKey = loadEnvValue(["HOT_MONEY_SILICONFLOW_API_KEY", "SILICONFLOW_API_KEY"]);
  if (!apiKey) throw new Error("未配置 HOT_MONEY_SILICONFLOW_API_KEY");
  const baseUrl = (loadEnvValue("SILICONFLOW_BASE_URL") || "https://api.siliconflow.cn/v1").replace(/\/$/, "");
  const model = loadEnvValue("SILICONFLOW_REVIEW_MODEL_OVERRIDE") || loadEnvValue("SILICONFLOW_REVIEW_MODEL") || "moonshotai/Kimi-K2.7-Code";
  const maxTokens = Math.max(12000, Number(loadEnvValue("SILICONFLOW_REVIEW_MAX_TOKENS") || 16000));
  const prompt = [
    "请完整识别当前这一张同花顺涨停复盘图片中的表格内容，提取图片中每一行股票对应的详细涨停原因。图片是唯一权威来源，网页文本不能替代图片内容。",
    "只输出 JSON 数组，不要 Markdown。每项格式为 {\"code\":\"6位代码\",\"name\":\"股票名称\",\"reason\":\"图片中该股票对应的详细涨停原因，完整保留事实，不要编造\"}。",
    "只输出当前图片实际出现的股票，图片中出现的股票必须全部输出，不能只输出少数示例。不要输出指数、行业板块或其他图片中的股票。无法看清的代码或原因不要猜测，保留为空会导致本图该行被复核。",
    ...(focusCodes.length ? [`本次是缺失行定向复核，请优先逐一检查这些代码并只返回图片中能确认的对应行：${focusCodes.join(",")}`] : []),
    `文章日期：${article.date}，标题：${article.title}`
  ].join("\n");
  const imageItems = [];
  for (const imageUrl of article.imageUrls || []) {
    // Pass the original THS URL directly. SiliconFlow accepts the OpenAI
    // image_url format, so no local download or Base64 conversion is needed.
    imageItems.push({ type: "image_url", image_url: { url: imageUrl, detail: "high" } });
  }
  if (!imageItems.length) throw new Error("文章中没有可发送的复盘图片");
  const extractOne = async (image, imageIndex) => {
    // Send one long table image per request. Sending all daily images in one
    // payload causes vision workers to time out before returning JSON.
    const response = await axios.post(`${baseUrl}/chat/completions`, {
      model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: "你是财经网页结构化抽取器，只能依据图片内容。" },
        { role: "user", content: [{ type: "text", text: prompt }, image] }
      ]
      , stream: true
      }, { responseType: "stream", timeout: reviewTimeoutMs(), headers: { Authorization: `Bearer ${apiKey}`, Accept: "text/event-stream" } });
    let timeoutId;
    let responseContent;
    try {
      responseContent = await Promise.race([
        readStreamingContent(response),
        new Promise((_, reject) => {
          const timeout = reviewTimeoutMs();
          timeoutId = setTimeout(() => reject(new Error(`Kimi 流式响应超过 ${Math.round(timeout / 60000)} 分钟未结束`)), timeout);
        })
      ]);
    } catch (error) {
      // Abort the underlying HTTP stream as well; otherwise a keep-alive-only
      // upstream response can leave the review run stuck indefinitely.
      response.data?.destroy?.();
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
    const items = parseModelJson(responseContent);
    return { imageIndex, items };
  };
  // Submit the three original article images concurrently. Each request still
  // contains one complete image; concurrency only reduces total wall time.
  const results = await Promise.all(imageItems.map((image, index) => extractOne(image, index + 1)));
  return { model, maxTokens, items: results.flatMap((result) => result.items), perImageCounts: results.map((result) => result.items.length) };
}

function decodeHttpHtml(data, charset = "utf-8") {
  if (typeof data === "string") return data;
  try { return new TextDecoder(charset).decode(data); }
  catch { return new TextDecoder("utf-8").decode(data); }
}

function localFallback(article) {
  // The article's text is not a substitute for the tabular image. When image
  // extraction is unavailable, keep existing stored data intact and let the
  // next scheduled run retry instead of persisting a misleading paragraph.
  if ((article.imageUrls || []).length) return [];
  return article.candidates.map((item) => {
    const context = item.contexts.find((value) => /涨停|异动原因|原因揭秘|连板/.test(value)) || item.contexts[0] || "";
    // Keep the fallback tied to the stock's own sentence instead of storing
    // the entire article paragraph for every stock when the LLM is unavailable.
    const sentence = context.split(/[。！？；]/).find((part) => part.includes(item.name)) || context;
    return { code: item.code, name: item.name, reason: cleanText(sentence).slice(0, 600) };
  }).filter((item) => item.reason);
}

export async function fetchThsDailyLimitUpReview(date) {
  const requestedDate = normalizeDate(date);
  if (!requestedDate) throw new Error("复盘日期无效");
  const listResponse = await axios.get(REVIEW_LIST_URL, { responseType: "arraybuffer", timeout: reviewTimeoutMs(), headers: { "User-Agent": USER_AGENT } });
  const metadata = parseReviewList(decodeHttpHtml(listResponse.data, "gbk"), requestedDate);
  if (!metadata) throw new Error(`同花顺未找到 ${requestedDate} 的涨停复盘文章`);
  const articleResponse = await axios.get(metadata.url, { responseType: "arraybuffer", timeout: reviewTimeoutMs(), headers: { "User-Agent": USER_AGENT, Referer: REVIEW_LIST_URL } });
  const charset = /charset\s*=\s*gbk/i.test(String(articleResponse.headers?.["content-type"] || "")) ? "gbk" : "utf-8";
  return parseArticle(decodeHttpHtml(articleResponse.data, charset), metadata);
}

const reviewInFlight = new Map();

// A vision run can miss one small cell while still extracting most of the
// article correctly. Preserve prior valid rows for the same review date so a
// retry can fill gaps rather than replacing a useful partial result.
export function mergeLimitUpReviewReasons(existingRows, detectedRows, allowedCodes = null) {
  const allowed = allowedCodes instanceof Set ? allowedCodes : null;
  const valid = (row) => {
    const code = String(row?.code || "");
    return /^\d{6}$/.test(code) && String(row?.reason || "").trim() && (!allowed || allowed.has(code));
  };
  return [...new Map([...(existingRows || []), ...(detectedRows || [])]
    .filter(valid)
    .map((row) => [String(row.code), row])).values()];
}

export async function fetchAndStoreThsDailyLimitUpReview(date, options = {}) {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) throw new Error("复盘日期无效");
  if (reviewInFlight.has(normalizedDate)) return reviewInFlight.get(normalizedDate);
  const run = (async () => {
    let article = null;
    let model = "";
    let extraction = null;
    try {
      const previous = await readStockDbLimitUpReviewStatus(normalizedDate).catch(() => null);
      if (!options.force && previous?.status === "completed") return { ok: true, skipped: true, ...previous };
      await writeStockDbLimitUpReviewStatus({ status: "running", startedAt: new Date().toISOString(), attempt: Number(previous?.attempt || 0) + 1 }, { date: normalizedDate }).catch(() => {});
      article = await fetchThsDailyLimitUpReview(normalizedDate);
      await writeStockDbLimitUpReviewStatus({ status: "running", startedAt: new Date().toISOString(), imageCount: article.imageUrls?.length || 0, attempt: Number(previous?.attempt || 0) + 1 }, { date: normalizedDate }).catch(() => {});
      let officialPool = null;
      try {
        const pool = await fetchThsLimitUpPool({ date: article.date, limit: 1000, ttlMs: 0 });
        if (String(pool?.date || "") === article.date && Array.isArray(pool.items) && pool.items.length) officialPool = pool.items;
      } catch {
        // The article can still be parsed when the live pool endpoint is down.
      }
      const sourceCandidates = [...(officialPool || []), ...article.candidates];
      const candidates = new Map(sourceCandidates
        .filter((item) => /^\d{6}$/.test(String(item?.code || "")))
        .map((item) => [String(item.code), item]));
      const candidatesByName = new Map(sourceCandidates
        .filter((item) => normalizeStockName(item.name))
        .map((item) => [normalizeStockName(item.name), item]));
      const allowedCodes = officialPool ? new Set(officialPool.map((item) => String(item.code))) : null;
      const expectedCount = officialPool?.length || article.candidates.length;
      const existing = await readStockDbLimitUpReasons(article.date).catch(() => []);
      const toRows = (items) => items.map((item) => {
        const parsedCode = String(item.code || "").replace(/\D/g, "").slice(-6);
        const parsedName = cleanText(item.name);
        const candidate = candidates.get(parsedCode) || candidatesByName.get(normalizeStockName(parsedName));
        const code = candidate?.code || parsedCode;
        const reason = cleanText(item.reason);
        if (!/^\d{6}$/.test(code) || !reason || (allowedCodes && !allowedCodes.has(code))) return null;
        return { date: article.date, code, name: candidate?.name || parsedName, reason, articleUrl: article.url, articleTitle: article.title, extractedBy: "siliconflow", model };
      }).filter(Boolean);
      extraction = await extractWithKimi(article);
      model = extraction.model;
      let deduped = [...new Map(toRows(extraction.items).map((item) => [item.code, item])).values()];
      if (!deduped.length) throw new Error("复盘图片识别未返回有效的股票详细原因");
      let storedRows = mergeLimitUpReviewReasons(existing, deduped, allowedCodes);
      // A long table can lose one or two small rows even when the main pass
      // succeeds. Re-read only the missing official codes with a focused
      // prompt, then merge the result without replacing valid prior rows.
      const missingCodes = officialPool
        ? officialPool.map((item) => String(item.code)).filter((code) => !storedRows.some((row) => row.code === code))
        : [];
      if (missingCodes.length && options.focusRetry !== false) {
        const focused = await extractWithKimi(article, missingCodes);
        model = focused.model || model;
        const focusedRows = toRows(focused.items);
        deduped = [...new Map([...deduped, ...focusedRows].map((item) => [item.code, item])).values()];
        storedRows = mergeLimitUpReviewReasons(existing, deduped, allowedCodes);
      }
      const stored = await writeStockDbLimitUpReasons(storedRows, { date: article.date, source: "同花顺涨停复盘图片", replace: true });
      const isComplete = expectedCount <= 0 || storedRows.length >= expectedCount;
      const reviewStatus = {
        status: isComplete ? "completed" : "partial",
        count: storedRows.length,
        extractedCount: deduped.length,
        expectedCount,
        missingCount: Math.max(0, expectedCount - storedRows.length),
        imageCount: article.imageUrls?.length || 0,
        model,
        articleUrl: article.url
      };
      await writeStockDbLimitUpReviewStatus(reviewStatus, { date: normalizedDate }).catch(() => {});
      const warning = isComplete ? "" : `复盘图片识别部分完成：已保存 ${storedRows.length}/${expectedCount} 只股票，缺少部分将自动重试。`;
      return { ok: isComplete, partial: !isComplete, date: article.date, title: article.title, url: article.url, imageCount: reviewStatus.imageCount, count: storedRows.length, extractedCount: deduped.length, expectedCount, missingCount: reviewStatus.missingCount, extractedBy: "siliconflow", model, stored, warning };
    } catch (error) {
      const failed = { status: "failed", count: 0, imageCount: article?.imageUrls?.length || 0, model, perImageCounts: extraction?.perImageCounts || [], error: error.message };
      await writeStockDbLimitUpReviewStatus(failed, { date: normalizedDate }).catch(() => {});
      console.warn(`[涨停复盘] Kimi 图片提取失败：${error.message}`);
      return { ok: false, date: normalizedDate, imageCount: failed.imageCount, count: 0, extractedBy: "siliconflow", model, warning: error.message };
    }
  })().finally(() => reviewInFlight.delete(normalizedDate));
  reviewInFlight.set(normalizedDate, run);
  return run;
}

export default { fetchThsDailyLimitUpReview, fetchAndStoreThsDailyLimitUpReview };
