import fs from "node:fs";
import path from "node:path";
import { retrieveKnowledgeContext } from "../knowledge-base/retriever.js";

const LLM_TIMEOUT_MS = 25000;

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

function stringify(value) {
  return JSON.stringify(value, null, 2);
}

function buildPrompt(snapshot, decision, knowledgeContext) {
  const newsItems = (snapshot?.liveContext?.fastNews ?? []).slice(0, 5).map((item) => item.title);
  const mxNewsItems = (snapshot?.liveContext?.mxNews ?? []).slice(0, 5).map((item) => item.title);
  const catalystThemes = (snapshot?.liveContext?.llmNewsAnalysis?.themeCatalysts ?? []).slice(0, 5).map((item) => ({
    theme: item.theme,
    strength: item.strength,
    eventType: item.eventType,
    sentiment: item.sentiment,
    reason: item.reason,
    detailedReason: item.detailedReason,
    decisionImpact: item.decisionImpact
  }));
  const rejectedNews = (snapshot?.liveContext?.llmNewsAnalysis?.rejectedNews ?? []).slice(0, 5);

  const snapshotDigest = {
    date: snapshot?.date ?? null,
    market: snapshot?.market ?? {},
    marketRegime: decision?.marketRegime ?? {},
    topThemes: (snapshot?.themes ?? []).slice(0, 3).map((item) => ({
      name: item.name,
      limitUpCount: item.limitUpCount,
      maxBoardHeight: item.maxBoardHeight,
      newsCatalystStrength: item.newsCatalystStrength,
      narrativeStrength: item.narrativeStrength,
      narrativeSustainability: item.narrativeSustainability,
      catalystEventType: item.catalystEventType,
      catalystReason: item.catalystReason,
      catalystDetailedReason: item.catalystDetailedReason,
      catalystDecisionImpact: item.catalystDecisionImpact
    })),
    leader: decision?.leaders?.leader?.name ?? null,
    corePool: (decision?.leaders?.corePool ?? []).slice(0, 5).map((item) => item.name),
    environment: decision?.overview?.environment,
    emotionCycle: decision?.overview?.emotionCycle,
    preferredMode: decision?.overview?.preferredMode,
    stylePreference: decision?.overview?.stylePreference,
    actionBias: decision?.execution?.actionBias,
    positionPlan: decision?.position?.totalPosition,
    riskControl: decision?.riskControl ?? {},
    guardrails: decision?.guardrails ?? {}
  };

  const systemPrompt = [
    "你是A股短线情绪交易分析助手。",
    "你只能根据给定的知识库摘录、当前快照和新闻催化做解释，不允许编造数据。",
    "你必须服从系统硬闸门和风险控制，不得给出比 actionBias 和 positionPlan 更激进的建议。",
    "请用简体中文输出详细原因分析，严格使用以下结构：",
    "1. 盘面定位",
    "2. 主线与龙头",
    "3. 新闻催化拆解",
    "4. 风险与反证",
    "5. 执行动作",
    "每一段都要写出数据证据、原因链条、以及对决策的直接影响。",
    "请特别解释当前的市场风格、 preferredMode 是否成立，以及为什么风控层会允许或禁止出手。",
    "如果有被过滤的噪音新闻，也要说明为什么它们不该成为交易依据。",
    "如 guardrails.blocked 为 true 或 riskControl.status 为 stop-trading，执行动作必须明确为空仓观察或停止出手。"
  ].join(" ");

  const userPrompt = [
    "当前决策摘要:",
    stringify(snapshotDigest),
    "",
    "新闻催化:",
    stringify({ eastmoneyNews: newsItems, mxNews: mxNewsItems, catalystThemes, rejectedNews }),
    "",
    "知识库摘录:",
    knowledgeContext?.combinedText || "无匹配摘录"
  ].join("\n");

  return { systemPrompt, userPrompt, usedNewsCount: newsItems.length + mxNewsItems.length };
}

function buildFallbackExplanation(snapshot, decision, knowledgeContext) {
  const theme = decision?.overview?.primaryTheme ?? "暂无明确主线";
  const leader = decision?.leaders?.leader?.name ?? "未识别龙头";
  const guardrailMode = decision?.guardrails?.mode ?? "normal";
  const riskStatus = decision?.riskControl?.status ?? "normal";
  const warnings = snapshot?.dataQuality?.warnings ?? [];
  const topDocs = (knowledgeContext?.documents ?? []).map((item) => item.title).slice(0, 3).join("、") || "无匹配文档";
  const primaryTheme = (snapshot?.themes ?? []).find((item) => item.name === theme) ?? null;
  const llmNews = (snapshot?.liveContext?.llmNewsAnalysis?.themeCatalysts ?? []).slice(0, 3);
  const rejected = (snapshot?.liveContext?.llmNewsAnalysis?.rejectedNews ?? []).slice(0, 3);

  return [
    `1. 盘面定位\n当前环境为 ${decision?.overview?.environment} / ${decision?.overview?.emotionCycle}，市场风格偏 ${decision?.overview?.stylePreference ?? "未知"}，当前模式为 ${decision?.overview?.preferredMode ?? "未知"}。硬闸门模式为 ${guardrailMode}，风险控制状态为 ${riskStatus}。环境判断主要来自涨停 ${snapshot?.market?.limitUpCount ?? 0} 家、跌停 ${snapshot?.market?.limitDownCount ?? 0} 家、炸板率 ${Math.round((snapshot?.market?.brokenBoardRate ?? 0) * 100)}% 与昨日强股反馈 ${Math.round((snapshot?.market?.yesterdayStrongFeedback ?? 0) * 100)}%。`,
    `2. 主线与龙头\n结合知识库 ${topDocs}，当前主线先看 ${theme}，核心观察股以 ${leader} 为先。题材催化强度约 ${Math.round((primaryTheme?.newsCatalystStrength ?? 0) * 100)}%，叙事强度约 ${Math.round((primaryTheme?.narrativeStrength ?? 0) * 100)}%。如果主线分散或梯队不足，就不能把单条新闻当成进攻依据。`,
    `3. 新闻催化拆解\n当前最强催化包括 ${llmNews.map((item) => `${item.theme}(${item.eventType},${Math.round(item.strength * 100)}%)`).join("、") || "无"}。这些新闻被视为有效催化，是因为它们能形成政策、产业链或公告层面的因果推动，而不是单纯的盘中异动描述。`,
    `4. 风险与反证\n数据风险包括 ${warnings.slice(0, 3).join("、") || "无明显缺口"}。被过滤掉的噪音新闻包括 ${rejected.map((item) => item.title).join("、") || "无"}，原因是它们无法提供可执行的题材催化。`,
    `5. 执行动作\n最终执行仍以系统结论为准，当前只允许 ${decision?.execution?.actionBias}，总仓位上限 ${decision?.position?.totalPosition}。如果盘中没有进一步验证主线、模式和龙头强度，就不能因为新闻看起来利好而主动提高仓位。`
  ].join("\n\n");
}

async function callSiliconFlow(prompt) {
  const apiKey = loadEnvValue("SILICONFLOW_API_KEY");
  if (!apiKey) {
    return null;
  }

  const baseUrl = (loadEnvValue("SILICONFLOW_BASE_URL") ?? "https://api.siliconflow.cn/v1").replace(/\/$/, "");
  const modelChain = [
    loadEnvValue("SILICONFLOW_MODEL_PRIMARY") ?? "deepseek-ai/DeepSeek-V3.2",
    loadEnvValue("SILICONFLOW_MODEL_BACKUP") ?? "Pro/deepseek-ai/DeepSeek-V3.2"
  ].filter(Boolean);

  const errors = [];
  for (let index = 0; index < modelChain.length; index += 1) {
    const model = modelChain[index];
    const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1800,
        messages: [
          { role: "system", content: prompt.systemPrompt },
          { role: "user", content: prompt.userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const message = `SiliconFlow ${model} failed: ${response.status} ${response.statusText}`;
      errors.push(message);
      continue;
    }

    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      errors.push(`SiliconFlow ${model} returned empty content.`);
      continue;
    }

    return {
      source: index === 0 ? "siliconflow-primary" : "siliconflow-backup",
      model,
      attemptedModels: modelChain.slice(0, index + 1),
      errors,
      text
    };
  }

  throw new Error(errors.join(" | "));
}

async function callOpenAICompatible(prompt) {
  const apiKey = loadEnvValue(["LLM_API_KEY", "OPENAI_API_KEY"]);
  if (!apiKey) {
    return null;
  }

  const baseUrl = (loadEnvValue(["LLM_BASE_URL", "OPENAI_BASE_URL"]) ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = loadEnvValue(["LLM_MODEL", "OPENAI_MODEL"]) ?? "gpt-4.1-mini";
  const response = await fetchWithTimeout(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            { type: "input_text", text: prompt.systemPrompt }
          ]
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt.userPrompt }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI-compatible request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const text = [payload?.output_text ?? "", ...(payload?.output ?? []).flatMap((item) => (item?.content ?? []).map((content) => content?.text ?? content?.text?.value ?? ""))]
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("OpenAI-compatible response did not contain readable text.");
  }

  return {
    source: "openai-compatible",
    model,
    attemptedModels: [model],
    errors: [],
    text
  };
}

export async function buildDecisionExplanation(snapshot, decision) {
  const knowledgeContext = retrieveKnowledgeContext(snapshot, decision);
  const prompt = buildPrompt(snapshot, decision, knowledgeContext);
  const enforcedLine = `\n\n执行约束：系统硬闸门已锁定为 ${decision?.execution?.actionBias} / ${decision?.position?.totalPosition}，风险控制状态 ${decision?.riskControl?.status ?? "normal"}。`;
  const basePayload = {
    usedNewsCount: prompt.usedNewsCount,
    knowledgeDocuments: (knowledgeContext?.documents ?? []).map((item) => item.title),
    knowledgeKeywords: knowledgeContext?.keywords ?? [],
    guardrailMode: decision?.guardrails?.mode ?? "normal",
    enforcedActionBias: decision?.execution?.actionBias,
    enforcedPositionPlan: decision?.position?.totalPosition
  };

  try {
    const siliconFlowResult = await callSiliconFlow(prompt);
    if (siliconFlowResult) {
      return {
        ...basePayload,
        source: siliconFlowResult.source,
        model: siliconFlowResult.model,
        attemptedModels: siliconFlowResult.attemptedModels,
        warning: knowledgeContext?.warning ?? (siliconFlowResult.errors.length > 0 ? siliconFlowResult.errors.join(" | ") : null),
        text: `${siliconFlowResult.text}${enforcedLine}`
      };
    }
  } catch (error) {
    try {
      const openAiResult = await callOpenAICompatible(prompt);
      if (openAiResult) {
        return {
          ...basePayload,
          source: openAiResult.source,
          model: openAiResult.model,
          attemptedModels: openAiResult.attemptedModels,
          warning: `${error.message}${knowledgeContext?.warning ? ` | ${knowledgeContext.warning}` : ""}`,
          text: `${openAiResult.text}${enforcedLine}`
        };
      }

      return {
        ...basePayload,
        source: "rule-fallback",
        model: null,
        attemptedModels: [],
        warning: `${error.message}${knowledgeContext?.warning ? ` | ${knowledgeContext.warning}` : ""}`,
        text: `${buildFallbackExplanation(snapshot, decision, knowledgeContext)}${enforcedLine}`
      };
    } catch (fallbackError) {
      return {
        ...basePayload,
        source: "rule-fallback",
        model: null,
        attemptedModels: [],
        warning: `${error.message} | ${fallbackError.message}${knowledgeContext?.warning ? ` | ${knowledgeContext.warning}` : ""}`,
        text: `${buildFallbackExplanation(snapshot, decision, knowledgeContext)}${enforcedLine}`
      };
    }
  }

  try {
    const openAiResult = await callOpenAICompatible(prompt);
    if (openAiResult) {
      return {
        ...basePayload,
        source: openAiResult.source,
        model: openAiResult.model,
        attemptedModels: openAiResult.attemptedModels,
        warning: knowledgeContext?.warning ?? null,
        text: `${openAiResult.text}${enforcedLine}`
      };
    }
  } catch (error) {
    return {
      ...basePayload,
      source: "rule-fallback",
      model: null,
      attemptedModels: [],
      warning: `${error.message}${knowledgeContext?.warning ? ` | ${knowledgeContext.warning}` : ""}`,
      text: `${buildFallbackExplanation(snapshot, decision, knowledgeContext)}${enforcedLine}`
    };
  }

  return {
    ...basePayload,
    source: "rule-fallback",
    model: null,
    attemptedModels: [],
    warning: knowledgeContext?.warning ?? "未检测到 SiliconFlow 或 OpenAI 兼容 API Key，已自动降级为规则解释模式。",
    text: `${buildFallbackExplanation(snapshot, decision, knowledgeContext)}${enforcedLine}`
  };
}

export function formatDecisionExplanation(explanation) {
  return [
    `LLM Source: ${explanation.source}`,
    `LLM Model: ${explanation.model ?? "fallback"}`,
    `Attempted Models: ${explanation.attemptedModels?.join(" -> ") || "None"}`,
    `Guardrail Mode: ${explanation.guardrailMode}`,
    `Knowledge Docs: ${explanation.knowledgeDocuments.join("、") || "None"}`,
    `Used News Count: ${explanation.usedNewsCount}`,
    `Explanation Warning: ${explanation.warning ?? "None"}`,
    "Detailed LLM Analysis:",
    explanation.text
  ].join("\n");
}

