import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../../data/cls-news.db');

class ClsDatabase {
  constructor() {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initTables();
  }

  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cls_news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        time TEXT,
        source TEXT DEFAULT '财联社',
        source_url TEXT,
        content_hash TEXT UNIQUE,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );

      CREATE INDEX IF NOT EXISTS idx_cls_created_at ON cls_news(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cls_title ON cls_news(title);
      CREATE INDEX IF NOT EXISTS idx_cls_content_hash ON cls_news(content_hash);
      CREATE INDEX IF NOT EXISTS idx_cls_time ON cls_news(time DESC);
    `);
  }

  generateContentHash(title, content, time) {
    const text = `${title}|${content || ''}|${time || ''}`;
    const crypto = require('node:crypto');
    return crypto.createHash('md5').update(text).digest('hex');
  }

  insertNews(newsItem) {
    const contentHash = this.generateContentHash(
      newsItem.title,
      newsItem.content,
      newsItem.time
    );

    try {
      const stmt = this.db.prepare(`
        INSERT INTO cls_news (title, content, time, source, source_url, content_hash)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        newsItem.title,
        newsItem.content || '',
        newsItem.time || '',
        newsItem.source || '财联社',
        newsItem.source_url || 'https://www.cls.cn/telegraph',
        contentHash
      );

      return { id: result.lastInsertRowid, duplicate: false };
    } catch (error) {
      if (error.message.includes('UNIQUE constraint failed')) {
        return { id: null, duplicate: true };
      }
      throw error;
    }
  }

  getAllNews(limit = 100, offset = 0) {
    const stmt = this.db.prepare(`
      SELECT * FROM cls_news
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset);
  }

  searchNews(keyword, limit = 100) {
    const stmt = this.db.prepare(`
      SELECT * FROM cls_news
      WHERE title LIKE ? OR content LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const searchPattern = `%${keyword}%`;
    return stmt.all(searchPattern, searchPattern, limit);
  }

  getNewsCount() {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM cls_news');
    return stmt.get().count;
  }

  getRecentNews(hours = 24) {
    const stmt = this.db.prepare(`
      SELECT * FROM cls_news
      WHERE created_at >= datetime('now', '-${hours} hours', 'localtime')
      ORDER BY created_at DESC
    `);
    return stmt.all();
  }

  close() {
    this.db.close();
  }
}

export default new ClsDatabase();
