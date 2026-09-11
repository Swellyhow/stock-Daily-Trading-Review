import fs from "node:fs";
import path from "node:path";

const THEME_CONCURRENCY = 3;
const LLM_TIMEOUT_MS = 20000;
const MAX_CANDIDATE_THEMES = 8;

async function fetchWithTimeout(url, options = {}, timeoutMs = LLM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`LLM request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function loadEnvValue(keys) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) {
    if (process.env[key]) {
      return process.env[key];
    }
  }

  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), ".codex", "skills", ".env")
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }
      const [envKey, ...rest] = trimmed.split("=");
      if (keyList.includes(envKey.trim())) {
        return rest.join("=").trim();
      }
    }
  }

  return null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dedupeNewsItems(items = []) {
  const seen = new Set();
  const merged = [];
  for (const item of items) {
    const title = item?.title ?? "";
    if (!title || seen.has(title)) {
      continue;
    }
    seen.add(title);
    merged.push(item);
  }
  return merged;
}

function buildCandidateThemes(state) {
  const industryCounts = new Map();
  for (const item of state.limitUpPool ?? []) {
    const key = item.industry || "";
    if (!key) {
      continue;
    }
    industryCounts.set(key, (industryCounts.get(key) ?? 0) + 1);
  }

  const rankedIndustries = [...industryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const conceptNames = (state.conceptBoards ?? []).map((item) => item.name).filter(Boolean);
  const mxSeeds = state.mxContext?.themeSeeds ?? [];

  return [...new Set([...rankedIndustries, ...conceptNames, ...mxSeeds])];
}

function isObviousNoiseNews(item) {
  const title = item?.title ?? "";
  return /点击查看全部|亚洲指数|澳洲股市|美洲股市|中国概念股|欧洲股市|实时汇率|人民币中间价/.test(title);
}

function splitNewsItems(items = []) {
  const obviousNoise = [];
  const relevant = [];

  for (const item of items) {
    if (isObviousNoiseNews(item)) {
      obviousNoise.push(item);
    } else {
      relevant.push(item);
    }
  }

  return { relevant, obviousNoise };
}

function stripCodeFence(text) {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function sanitizeJsonLike(text) {
  const stripped = stripCodeFence(text);
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  const sliced = start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;
  return sliced
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/\t/g, " ")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function parseJsonResponse(text) {
  const direct = stripCodeFence(text);
  try {
    return JSON.parse(direct);
  } catch {
    return JSON.parse(sanitizeJsonLike(text));
  }
}

function buildThemePrompt(theme, newsItems) {
  const compactNews = newsItems.map((item) => ({
    id: item.id,
    title: item.title ?? "",
    content: item.content ?? "",
    source: item.source ?? "",
    informationType: item.informationType ?? "",
    date: item.date ?? ""
  }));

  const systemPrompt = [
    "你是A股短线新闻催化分析器。",
    "你只分析单个题材与给定新闻之间是否形成有效短线催化。",
    "你必须返回严格合法 JSON，不要输出 markdown，不要输出解释文字。",
    "你只能输出一个 JSON 对象，并且必须包含全部字段。",
    "eventType 只能是 policy、announcement、industry-chain、earnings、flow、general、none。",
    "sentiment 只能是 bullish、neutral、bearish。",
    "duration 只能是 one-off、short、medium。",
    "scope 只能是 stock、theme、market。",
    "isCatalyst 为 false 时，strength 必须为 0，headlineIds 可以为空数组。",
    "reason 控制在 35 个字以内，所有字符串中不要包含真实换行。"
  ].join(" ");

  const userPrompt = JSON.stringify({
    theme,
    newsItems: compactNews,
    requiredShape: {
      theme,
      isCatalyst: true,
      eventType: "policy",
      sentiment: "bullish",
      strength: 0.75,
      duration: "short",
      scope: "theme",
      reason: "一句话说明是否构成催化",
      detailedReason: "详细因果链条",
      decisionImpact: "对短线交易决策的直接影响",
      riskNote: "该催化仍需警惕的风险",
      headlineIds: [1, 2],
      rejectedHeadlineIds: [3]
    },
    rules: [
      "如果新闻不足以支撑该题材，返回 isCatalyst=false,eventType=none,strength=0。",
      "headlineIds 只能填写真正支持该题材判断的新闻id。",
      "rejectedHeadlineIds 填写你认为和该题材弱相关或不构成催化的新闻id。"
    ]
  });

  return { systemPrompt, userPrompt };
}

function buildRepairPrompt(theme, malformedText) {
  const systemPrompt = [
    "你是JSON修复器。",
    "你的任务是把给定的损坏输出修复为严格合法 JSON。",
    "你必须只返回 JSON 对象，不要输出 markdown，不要补充解释。",
    "对象必须包含 theme、isCatalyst、eventType、sentiment、strength、duration、scope、reason、detailedReason、decisionImpact、riskNote、headlineIds、rejectedHeadlineIds 全部字段。"
  ].join(" ");

  const userPrompt = JSON.stringify({
    theme,
    malformedText,
    requiredShape: {
      theme,
      isCatalyst: false,
      eventType: "none",
      sentiment: "neutral",
      strength: 0,
      duration: "one-off",
      scope: "theme",
      reason: "未能从新闻中确认有效催化",
      detailedReason: "模型原始输出已损坏，修复后未确认有效催化。",
      decisionImpact: "不应因为该题材的新闻噪音提高参与级别。",
      riskNote: "需等待更明确的政策、公告或产业链证据。",
      headlineIds: [],
      rejectedHeadlineIds: []
    }
  });

  return { systemPrompt, userPrompt };
}

function getModelChain() {
  const primary = loadEnvValue("SILICONFLOW_MODEL_PRIMARY") ?? "deepseek-ai/DeepSeek-V3.2";
  const backup = loadEnvValue("SILICONFLOW_MODEL_BACKUP") ?? "Pro/deepseek-ai/DeepSeek-V3.2";
  return [...new Set([primary, backup].filter(Boolean))];
}

async function requestSiliconFlow(model, prompt, maxTokens) {
  const apiKey = loadEnvValue("SILICONFLOW_API_KEY");
  if (!apiKey) {
    throw new Error("Missing SILICONFLOW_API_KEY");
  }

  const baseUrl = (loadEnvValue("SILICONFLOW_BASE_URL") ?? "https://api.siliconflow.cn/v1").replace(/\/$/, "");
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: prompt.systemPrompt },
        { role: "user", content: prompt.userPrompt }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`SiliconFlow ${model} failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error(`SiliconFlow ${model} returned empty content.`);
  }

  return text;
}

async function requestThemeJson(theme, prompt) {
  const models = getModelChain();
  const errors = [];

  for (const model of models) {
    try {
      const text = await requestSiliconFlow(model, prompt, 700);
      try {
        return {
          model,
          attemptedModels: [...new Set([model])],
          payload: parseJsonResponse(text),
          warning: null
        };
      } catch (parseError) {
        errors.push(`SiliconFlow ${model} parse failed: ${parseError.message}`);
        try {
          const repairedText = await requestSiliconFlow(model, buildRepairPrompt(theme, text), 500);
          return {
            model,
            attemptedModels: [...new Set([model])],
            payload: parseJsonResponse(repairedText),
            warning: `SiliconFlow ${model} 原始输出已自动修复。`
          };
        } catch (repairError) {
          errors.push(`SiliconFlow ${model} repair failed: ${repairError.message}`);
        }
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(errors.join(" | "));
}

function normalizeThemeResult(theme, raw, newsItems, meta = {}) {
  const newsMap = new Map(newsItems.map((item) => [item.id, item]));
  const allowedIds = new Set(newsItems.map((item) => item.id));
  const headlineIds = Array.isArray(raw?.headlineIds)
    ? raw.headlineIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && allowedIds.has(id))
    : [];
  const rejectedHeadlineIds = Array.isArray(raw?.rejectedHeadlineIds)
    ? raw.rejectedHeadlineIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && allowedIds.has(id) && !headlineIds.includes(id))
    : [];

  const normalizedStrength = clamp(Number(raw?.strength ?? 0), 0, 1);
  const isCatalyst = Boolean(raw?.isCatalyst) && normalizedStrength > 0;
  const eventType = ["policy", "announcement", "industry-chain", "earnings", "flow", "general", "none"].includes(raw?.eventType)
    ? raw.eventType
    : (isCatalyst ? "general" : "none");

  return {
    theme,
    isCatalyst,
    eventType,
    sentiment: ["bullish", "neutral", "bearish"].includes(raw?.sentiment) ? raw.sentiment : "neutral",
    strength: isCatalyst ? normalizedStrength : 0,
    duration: ["one-off", "short", "medium"].includes(raw?.duration) ? raw.duration : "one-off",
    scope: ["stock", "theme", "market"].includes(raw?.scope) ? raw.scope : "theme",
    reason: String(raw?.reason ?? (isCatalyst ? "模型确认存在有效催化。" : "未能从新闻中确认有效催化")).trim(),
    detailedReason: String(raw?.detailedReason ?? (isCatalyst ? "该题材具备一定的事件驱动逻辑。" : "当前新闻不足以支撑题材级交易催化。" )).trim(),
    decisionImpact: String(raw?.decisionImpact ?? (isCatalyst ? "可作为题材排序与观察优先级的加分项。" : "不应因为该题材的新闻噪音提高参与级别。" )).trim(),
    riskNote: String(raw?.riskNote ?? (isCatalyst ? "仍需结合盘中承接、强度与扩散验证持续性。" : "等待更明确的政策、公告或产业链证据。" )).trim(),
    headlineIds,
    headlineTitles: headlineIds.map((id) => newsMap.get(id)?.title).filter(Boolean),
    rejectedHeadlineIds,
    rejectedHeadlineTitles: rejectedHeadlineIds.map((id) => newsMap.get(id)?.title).filter(Boolean),
    model: meta.model ?? null,
    attemptedModels: meta.attemptedModels ?? [],
    warning: meta.warning ?? null
  };
}

function buildFailureThemeResult(theme, warning) {
  return {
    theme,
    isCatalyst: false,
    eventType: "none",
    sentiment: "neutral",
    strength: 0,
    duration: "one-off",
    scope: "theme",
    reason: "模型未确认有效催化。",
    detailedReason: "结构化语义分析未成功产出该题材的有效催化判断。",
    decisionImpact: "该题材新闻不应参与本次题材加分。",
    riskNote: "需等待更明确且可验证的增量信息。",
    headlineIds: [],
    headlineTitles: [],
    rejectedHeadlineIds: [],
    rejectedHeadlineTitles: [],
    model: null,
    attemptedModels: [],
    warning
  };
}

function selectNewsForTheme(theme, relevantNews) {
  const scored = relevantNews
    .map((item) => {
      const title = item.title ?? "";
      const content = item.content ?? "";
      let score = 0;
      if (title.includes(theme)) {
        score += 4;
      }
      if (content.includes(theme)) {
        score += 3;
      }
      if (theme.length >= 4 && title.includes(theme.slice(0, 4))) {
        score += 1;
      }
      return { item, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map((item) => item.item);
}

async function analyzeSingleTheme(theme, relevantNews) {
  const themeNews = selectNewsForTheme(theme, relevantNews);
  if (themeNews.length === 0) {
    return buildFailureThemeResult(theme, "没有找到与该题材直接相关的有效新闻，保持空结果。");
  }

  try {
    const result = await requestThemeJson(theme, buildThemePrompt(theme, themeNews));
    return normalizeThemeResult(theme, result.payload, themeNews, result);
  } catch (error) {
    return buildFailureThemeResult(theme, error.message);
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function groupCatalystsByType(themeCatalysts = []) {
  const grouped = {
    policy: [],
    announcement: [],
    "industry-chain": [],
    earnings: [],
    flow: [],
    general: []
  };

  for (const item of themeCatalysts) {
    const key = item.eventType ?? "general";
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(item);
  }

  return Object.fromEntries(
    Object.entries(grouped).map(([key, items]) => [key, items.sort((a, b) => b.strength - a.strength)])
  );
}

function buildRejectedNews(obviousNoise, themeResults, allNews) {
  const allNewsMap = new Map(allNews.map((item) => [item.id, item]));
  const rejectedMap = new Map();

  for (const item of obviousNoise) {
    rejectedMap.set(item.id, {
      headlineId: item.id,
      label: "noise",
      reason: "导航类或市场总览类信息，不构成题材催化。",
      title: item.title
    });
  }

  for (const result of themeResults) {
    for (const id of result.rejectedHeadlineIds ?? []) {
      if (rejectedMap.has(id)) {
        continue;
      }
      rejectedMap.set(id, {
        headlineId: id,
        label: "weak-catalyst",
        reason: `${result.theme}: 被判定为弱相关或不构成有效催化。`,
        title: allNewsMap.get(id)?.title ?? ""
      });
    }
  }

  return [...rejectedMap.values()].filter((item) => item.title);
}

function summarizeModels(themeResults) {
  const models = [...new Set(themeResults.map((item) => item.model).filter(Boolean))];
  return models.length === 1 ? models[0] : (models.length > 1 ? models.join(" | ") : null);
}

export async function analyzeNewsCatalysts(state) {
  const mergedNews = dedupeNewsItems([
    ...(state.fastNews ?? []),
    ...(state.mxContext?.newsItems ?? [])
  ]).map((item, index) => ({ ...item, id: index + 1 }));
  const { relevant: relevantNews, obviousNoise } = splitNewsItems(mergedNews);
  const candidateThemes = buildCandidateThemes(state).slice(0, MAX_CANDIDATE_THEMES);
  const basePayload = {
    candidateThemes,
    newsCount: mergedNews.length,
    relevantNewsCount: relevantNews.length
  };

  if (candidateThemes.length === 0) {
    return {
      ...basePayload,
      source: "llm-theme-calls",
      model: null,
      attemptedModels: [],
      warning: "候选题材为空，跳过新闻语义分析。",
      themeCatalysts: [],
      catalystBuckets: groupCatalystsByType([]),
      rejectedNews: buildRejectedNews(obviousNoise, [], mergedNews),
      themeDiagnostics: []
    };
  }

  if (relevantNews.length === 0) {
    const diagnostics = candidateThemes.map((theme) => buildFailureThemeResult(theme, "相关新闻为空，未执行语义分析。"));
    return {
      ...basePayload,
      source: "llm-theme-calls",
      model: null,
      attemptedModels: [],
      warning: "有效新闻为空，未执行题材语义分析。",
      themeCatalysts: [],
      catalystBuckets: groupCatalystsByType([]),
      rejectedNews: buildRejectedNews(obviousNoise, diagnostics, mergedNews),
      themeDiagnostics: diagnostics
    };
  }

  const themeResults = await mapWithConcurrency(candidateThemes, THEME_CONCURRENCY, (theme) => analyzeSingleTheme(theme, relevantNews));
  const themeCatalysts = themeResults
    .filter((item) => item.isCatalyst && item.strength > 0)
    .sort((a, b) => b.strength - a.strength);
  const warnings = themeResults.map((item) => item.warning).filter(Boolean);
  const attemptedModels = [...new Set(themeResults.flatMap((item) => item.attemptedModels ?? []).filter(Boolean))];

  return {
    ...basePayload,
    source: "llm-theme-calls",
    model: summarizeModels(themeResults),
    attemptedModels,
    warning: warnings.join(" | ") || null,
    themeCatalysts,
    catalystBuckets: groupCatalystsByType(themeCatalysts),
    rejectedNews: buildRejectedNews(obviousNoise, themeResults, mergedNews),
    themeDiagnostics: themeResults
  };
}





