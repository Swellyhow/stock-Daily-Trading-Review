import fs from "node:fs";
import path from "node:path";
import { buildDashboardData } from "./lib/web/dashboard-data.js";

const rootDir = process.cwd();
const webDataDir = path.join(rootDir, "web", "data");
const outputFile = path.join(webDataDir, "dashboard-data.js");

fs.mkdirSync(webDataDir, { recursive: true });
const data = buildDashboardData({ rootDir });
const payload = `window.__DASHBOARD_DATA__ = ${JSON.stringify(data, null, 2)};\n`;
fs.writeFileSync(outputFile, payload, "utf8");
console.log(`Built dashboard data: ${path.relative(rootDir, outputFile)}`);
