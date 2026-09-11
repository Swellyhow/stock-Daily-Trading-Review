import fs from "node:fs";
import path from "node:path";

const UTF8_BOM = "\uFEFF";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${UTF8_BOM}${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeText(filePath, text) {
  fs.writeFileSync(filePath, `${UTF8_BOM}${text}\n`, "utf8");
}

export function archiveLiveDecision(date, snapshot, decision, workflow, llmExplanation, formattedText, session = null) {
  const safeDate = date ?? snapshot.date ?? decision.meta.date ?? "undated";
  const historyDir = path.resolve(process.cwd(), "outputs", "history", safeDate, "live");
  const dailyDir = path.resolve(process.cwd(), "outputs", "daily", safeDate);
  ensureDir(historyDir);
  ensureDir(dailyDir);

  const workflowType = session?.analysisType ?? "premarket";
  const payload = {
    snapshot,
    decision,
    session,
    workflowType,
    workflow,
    premarket: workflowType === "premarket" ? workflow : null,
    postmarket: workflowType === "postmarket" ? workflow : null,
    llmExplanation,
    llmNewsAnalysis: snapshot.liveContext?.llmNewsAnalysis ?? null
  };

  writeJson(path.join(historyDir, "auto-live.json"), payload);
  writeText(path.join(historyDir, "auto-live.txt"), formattedText);
  writeJson(path.join(dailyDir, "auto-live.json"), payload);
  writeText(path.join(dailyDir, "auto-live.txt"), formattedText);
  writeJson(path.join(dailyDir, "news-catalysts.json"), snapshot.liveContext?.llmNewsAnalysis ?? null);
}
