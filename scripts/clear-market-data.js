import marketDatabase from "../src/lib/collector/market-database.js";

if (!process.argv.includes("--confirm")) {
  console.error("This removes market observations from src/data/market.db. Re-run with --confirm.");
  process.exitCode = 2;
} else {
  const counts = marketDatabase.clearMarketData();
  console.log(JSON.stringify({ ok: true, cleared: counts, preserved: ["ui_preferences"] }, null, 2));
}
marketDatabase.close();
