import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(__dirname, "../data");
const dbPath = path.join(dbDir, "news.db");

// 确保目录存在
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

// 创建新闻表
db.exec(`
  CREATE TABLE IF NOT EXISTS news (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT,
    trunk TEXT,
    date TEXT NOT NULL,
    published_at TEXT NOT NULL,
    source TEXT NOT NULL,
    source_family TEXT NOT NULL,
    information_type TEXT,
    information_type_label TEXT,
    jump_url TEXT,
    image TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_news_published_at ON news(published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_news_date ON news(date DESC);
  CREATE INDEX IF NOT EXISTS idx_news_source_family ON news(source_family);
  CREATE INDEX IF NOT EXISTS idx_news_created_at ON news(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_news_title_fts ON news(title);
`);

// 插入或更新新闻
const upsertStmt = db.prepare(`
  INSERT INTO news (
    id, title, content, trunk, date, published_at, source, source_family,
    information_type, information_type_label, jump_url, image
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    content = excluded.content,
    trunk = excluded.trunk,
    date = excluded.date,
    published_at = excluded.published_at,
    source = excluded.source,
    source_family = excluded.source_family,
    information_type = excluded.information_type,
    information_type_label = excluded.information_type_label,
    jump_url = excluded.jump_url,
    image = excluded.image,
    updated_at = strftime('%s', 'now')
`);

export function upsertNews(items) {
  const insert = db.transaction((newsItems) => {
    for (const item of newsItems) {
      upsertStmt.run(
        item.id,
        item.title,
        item.content || null,
        item.trunk || null,
        item.date,
        item.publishedAt,
        item.source,
        item.sourceFamily || item.source,
        item.informationType || null,
        item.informationTypeLabel || null,
        item.jumpUrl || null,
        item.image || null
      );
    }
  });
  insert(items);
}

export function getLatestNews(limit = 50, offset = 0) {
  const stmt = db.prepare(`
    SELECT
      id, title, content, trunk, date, published_at as publishedAt,
      source, source_family as sourceFamily, information_type as informationType,
      information_type_label as informationTypeLabel, jump_url as jumpUrl, image
    FROM news
    ORDER BY published_at DESC
    LIMIT ? OFFSET ?
  `);
  return stmt.all(limit, offset);
}

export function getNewsByDateRange(startDate, endDate, limit = 100) {
  const stmt = db.prepare(`
    SELECT
      id, title, content, trunk, date, published_at as publishedAt,
      source, source_family as sourceFamily, information_type as informationType,
      information_type_label as informationTypeLabel, jump_url as jumpUrl, image
    FROM news
    WHERE date >= ? AND date <= ?
    ORDER BY published_at DESC
    LIMIT ?
  `);
  return stmt.all(startDate, endDate, limit);
}

export function searchNews(keyword, limit = 50) {
  const stmt = db.prepare(`
    SELECT
      id, title, content, trunk, date, published_at as publishedAt,
      source, source_family as sourceFamily, information_type as informationType,
      information_type_label as informationTypeLabel, jump_url as jumpUrl, image
    FROM news
    WHERE title LIKE ? OR content LIKE ?
    ORDER BY published_at DESC
    LIMIT ?
  `);
  const pattern = `%${keyword}%`;
  return stmt.all(pattern, pattern, limit);
}

export function getNewsStats() {
  const totalStmt = db.prepare("SELECT COUNT(*) as total FROM news");
  const sourceStmt = db.prepare(`
    SELECT source_family, COUNT(*) as count
    FROM news
    GROUP BY source_family
    ORDER BY count DESC
  `);
  const latestStmt = db.prepare(`
    SELECT MAX(published_at) as latest FROM news
  `);

  return {
    total: totalStmt.get().total,
    sources: sourceStmt.all(),
    latestUpdate: latestStmt.get().latest
  };
}

export function getLatestNewsId() {
  const stmt = db.prepare("SELECT id FROM news ORDER BY created_at DESC LIMIT 1");
  const result = stmt.get();
  return result?.id || null;
}

export { db };
