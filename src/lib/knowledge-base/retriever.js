import fs from "node:fs";
import path from "node:path";

const CORE_TERMS = ["情绪", "主线", "龙头", "仓位", "分歧", "一致", "回流", "回封", "竞价", "退潮", "发酵"];

function splitSections(text) {
  const blocks = text
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  return blocks.map((block, index) => {
    const lines = block.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const heading = lines.find((item) => item.startsWith("#"))?.replace(/^#+\s*/, "") ?? `Section ${index + 1}`;
    return {
      heading,
      text: lines.join("\n")
    };
  });
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function extractKeywords(snapshot, decision) {
  return unique([
    decision?.overview?.environment,
    decision?.overview?.emotionCycle,
    decision?.overview?.primaryTheme,
    decision?.leaders?.leader?.name,
    ...(snapshot?.themes ?? []).slice(0, 4).map((item) => item.name),
    ...(snapshot?.liveContext?.mxThemeSeeds ?? []).slice(0, 4),
    ...CORE_TERMS
  ]).filter((item) => item && item !== "No clear mainline");
}

function scoreText(text, keywords) {
  let score = 0;
  for (const keyword of keywords) {
    if (!keyword) {
      continue;
    }
    if (text.includes(keyword)) {
      score += keyword.length >= 4 ? 3 : 2;
    }
  }
  if (/允许买点|禁止买点|仓位|主线|龙头|分歧|回流|回封|竞价/.test(text)) {
    score += 2;
  }
  return score;
}

function buildDocumentBrief(filePath, keywords) {
  const text = fs.readFileSync(filePath, "utf8");
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(filePath, ".md");
  const sections = splitSections(text)
    .map((section) => ({
      ...section,
      score: scoreText(section.text, keywords)
    }))
    .filter((section) => section.score > 0)
    .sort((a, b) => b.score - a.score);

  if (sections.length === 0) {
    return null;
  }

  return {
    fileName: path.basename(filePath),
    title,
    score: sections.slice(0, 3).reduce((sum, item) => sum + item.score, 0),
    excerpts: sections.slice(0, 3).map((item) => ({
      heading: item.heading,
      score: item.score,
      text: item.text.slice(0, 260)
    }))
  };
}

export function retrieveKnowledgeContext(snapshot, decision, options = {}) {
  const knowledgeDir = path.resolve(process.cwd(), "游资知识库");
  const maxDocuments = options.maxDocuments ?? 3;
  const keywords = extractKeywords(snapshot, decision);

  if (!fs.existsSync(knowledgeDir)) {
    return {
      available: false,
      keywords,
      documents: [],
      combinedText: "",
      warning: "Knowledge base directory not found."
    };
  }

  const documents = fs.readdirSync(knowledgeDir)
    .filter((fileName) => fileName.endsWith(".md"))
    .map((fileName) => buildDocumentBrief(path.join(knowledgeDir, fileName), keywords))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxDocuments);

  return {
    available: documents.length > 0,
    keywords,
    documents,
    combinedText: documents
      .map((doc) => [
        `文档: ${doc.title}`,
        ...doc.excerpts.map((excerpt) => `${excerpt.heading}: ${excerpt.text}`)
      ].join("\n"))
      .join("\n\n"),
    warning: documents.length === 0 ? "No relevant knowledge excerpts matched the current snapshot." : null
  };
}
