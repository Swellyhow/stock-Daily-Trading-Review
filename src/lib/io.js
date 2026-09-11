import fs from "node:fs";
import path from "node:path";

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readJsonFile(filePath) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Input file not found: ${resolvedPath}`);
  }

  const raw = fs.readFileSync(resolvedPath, "utf8");
  return {
    resolvedPath,
    json: JSON.parse(stripBom(raw))
  };
}
