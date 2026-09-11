import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../../data/market.db');

class MarketDatabase {
  constructor() {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initTables();
  }

  initTables() {
    this.db.exec(`
      -- 个股K线历史数据
      CREATE TABLE IF NOT EXISTS stock_kline (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        name TEXT,
        date TEXT NOT NULL,
        open REAL,
        close REAL,
        high REAL,
        low REAL,
        volume BIGINT,
        amount BIGINT,
        change_pct REAL,
        amplitude_pct REAL,
        turnover_pct REAL,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(code, date)
      );

      CREATE INDEX IF NOT EXISTS idx_stock_kline_code ON stock_kline(code);
      CREATE INDEX IF NOT EXISTS idx_stock_kline_date ON stock_kline(date DESC);
      CREATE INDEX IF NOT EXISTS idx_stock_kline_code_date ON stock_kline(code, date DESC);

      -- 涨停池历史数据
      CREATE TABLE IF NOT EXISTS limit_up_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT,
        latest_price REAL,
        change_pct REAL,
        amount BIGINT,
        turnover_pct REAL,
        board_count INTEGER,
        first_limit_time TEXT,
        last_limit_time TEXT,
        seal_amount BIGINT,
        broken_count INTEGER,
        industry TEXT,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(date, code)
      );

      CREATE INDEX IF NOT EXISTS idx_limit_up_date ON limit_up_history(date DESC);
      CREATE INDEX IF NOT EXISTS idx_limit_up_code ON limit_up_history(code);
      CREATE INDEX IF NOT EXISTS idx_limit_up_board_count ON limit_up_history(board_count DESC);

      -- 跌停池历史数据
      CREATE TABLE IF NOT EXISTS limit_down_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT,
        latest_price REAL,
        change_pct REAL,
        amount BIGINT,
        turnover_pct REAL,
        industry TEXT,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(date, code)
      );

      CREATE INDEX IF NOT EXISTS idx_limit_down_date ON limit_down_history(date DESC);
      CREATE INDEX IF NOT EXISTS idx_limit_down_code ON limit_down_history(code);

      -- 概念板块历史数据
      CREATE TABLE IF NOT EXISTS sector_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        sector_code TEXT NOT NULL,
        sector_name TEXT,
        latest_price REAL,
        change_pct REAL,
        main_inflow BIGINT,
        leader_code TEXT,
        leader_name TEXT,
        leader_change_pct REAL,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(date, sector_code)
      );

      CREATE INDEX IF NOT EXISTS idx_sector_date ON sector_history(date DESC);
      CREATE INDEX IF NOT EXISTS idx_sector_code ON sector_history(sector_code);
      CREATE INDEX IF NOT EXISTS idx_sector_change_pct ON sector_history(change_pct DESC);

      -- 市场指数历史数据
      CREATE TABLE IF NOT EXISTS index_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        index_code TEXT NOT NULL,
        index_name TEXT,
        latest_price REAL,
        prev_close REAL,
        change_pct REAL,
        change_amount REAL,
        amplitude_pct REAL,
        volume BIGINT,
        amount BIGINT,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(date, index_code)
      );

      CREATE INDEX IF NOT EXISTS idx_index_date ON index_history(date DESC);
      CREATE INDEX IF NOT EXISTS idx_index_code ON index_history(index_code);

      -- 竞价数据
      CREATE TABLE IF NOT EXISTS auction_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT,
        auction_price REAL,
        auction_change_pct REAL,
        auction_volume BIGINT,
        auction_amount BIGINT,
        prev_close REAL,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(date, code)
      );

      CREATE INDEX IF NOT EXISTS idx_auction_date ON auction_data(date DESC);
      CREATE INDEX IF NOT EXISTS idx_auction_code ON auction_data(code);
      CREATE INDEX IF NOT EXISTS idx_auction_change_pct ON auction_data(auction_change_pct DESC);

      -- 集合竞价期间的连续采样快照，用于还原价格波动和生成竞价K线
      CREATE TABLE IF NOT EXISTS auction_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        sample_time TEXT NOT NULL,
        sampled_at TEXT NOT NULL,
        sampled_at_ms INTEGER NOT NULL,
        code TEXT NOT NULL,
        name TEXT,
        auction_price REAL,
        auction_change_pct REAL,
        auction_volume BIGINT,
        auction_amount BIGINT,
        prev_close REAL,
        open REAL,
        high REAL,
        low REAL,
        turnover_pct REAL,
        volume_ratio REAL,
        source TEXT DEFAULT 'eastmoney',
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(date, code, sampled_at_ms)
      );

      CREATE INDEX IF NOT EXISTS idx_auction_snapshots_date_code_time
        ON auction_snapshots(date, code, sampled_at_ms);
      CREATE INDEX IF NOT EXISTS idx_auction_snapshots_date_time
        ON auction_snapshots(date, sampled_at_ms);

      -- 个股/板块分时快照缓存
      CREATE TABLE IF NOT EXISTS intraday_cache (
        cache_key TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT,
        payload TEXT NOT NULL,
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );

      CREATE INDEX IF NOT EXISTS idx_intraday_cache_date_code
        ON intraday_cache(date, code);

      -- 市场管理工作台接口响应缓存（板块、成分股、K线、实时摘要）
      CREATE TABLE IF NOT EXISTS market_management_cache (
        cache_key TEXT PRIMARY KEY,
        data_type TEXT NOT NULL,
        date TEXT,
        code TEXT,
        payload TEXT NOT NULL,
        source TEXT,
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );

      CREATE INDEX IF NOT EXISTS idx_market_management_cache_type
        ON market_management_cache(data_type, updated_at);

      -- 数据同步记录
      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_type TEXT NOT NULL,
        sync_date TEXT NOT NULL,
        record_count INTEGER,
        status TEXT,
        error_message TEXT,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );

      CREATE INDEX IF NOT EXISTS idx_sync_log_type_date ON sync_log(data_type, sync_date DESC);

      -- 本地工作台偏好设置（布局、字段显隐等）
      CREATE TABLE IF NOT EXISTS ui_preferences (
        preference_key TEXT PRIMARY KEY,
        preference_value TEXT NOT NULL,
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );
    `);
  }

  // ==================== 个股K线数据 ====================

  insertStockKline(klineData) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO stock_kline
      (code, name, date, open, close, high, low, volume, amount, change_pct, amplitude_pct, turnover_pct)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      klineData.code,
      klineData.name,
      klineData.date,
      klineData.open,
      klineData.close,
      klineData.high,
      klineData.low,
      klineData.volume,
      klineData.amount,
      klineData.changePct,
      klineData.amplitudePct,
      klineData.turnoverPct
    );
  }

  batchInsertStockKline(klineDataArray) {
    const insert = this.db.transaction((items) => {
      for (const item of items) {
        this.insertStockKline(item);
      }
    });
    return insert(klineDataArray);
  }

  getStockKline(code, startDate, endDate, limit = 100) {
    let query = 'SELECT * FROM stock_kline WHERE code = ?';
    const params = [code];

    if (startDate) {
      query += ' AND date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND date <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY date DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  getLatestKlineDate(code) {
    const stmt = this.db.prepare('SELECT MAX(date) as latest_date FROM stock_kline WHERE code = ?');
    const result = stmt.get(code);
    return result?.latest_date || null;
  }

  // ==================== 涨停池历史 ====================

  insertLimitUp(limitUpData) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO limit_up_history
      (date, code, name, latest_price, change_pct, amount, turnover_pct,
       board_count, first_limit_time, last_limit_time, seal_amount, broken_count, industry)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      limitUpData.date,
      limitUpData.code,
      limitUpData.name,
      limitUpData.latestPrice,
      limitUpData.changePct,
      limitUpData.amount,
      limitUpData.turnoverPct,
      limitUpData.boardCount,
      limitUpData.firstLimitTime,
      limitUpData.lastLimitTime,
      limitUpData.sealAmount,
      limitUpData.brokenCount,
      limitUpData.industry
    );
  }

  batchInsertLimitUp(limitUpArray) {
    const insert = this.db.transaction((items) => {
      for (const item of items) {
        this.insertLimitUp(item);
      }
    });
    return insert(limitUpArray);
  }

  getLimitUpHistory(date, code = null) {
    if (code) {
      const stmt = this.db.prepare('SELECT * FROM limit_up_history WHERE date = ? AND code = ?');
      return stmt.get(date, code);
    } else {
      const stmt = this.db.prepare('SELECT * FROM limit_up_history WHERE date = ? ORDER BY board_count DESC, seal_amount DESC');
      return stmt.all(date);
    }
  }

  getLimitUpByDateRange(startDate, endDate, code = null) {
    let query = 'SELECT * FROM limit_up_history WHERE date >= ? AND date <= ?';
    const params = [startDate, endDate];

    if (code) {
      query += ' AND code = ?';
      params.push(code);
    }

    query += ' ORDER BY date DESC, board_count DESC';
    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  // ==================== 跌停池历史 ====================

  insertLimitDown(limitDownData) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO limit_down_history
      (date, code, name, latest_price, change_pct, amount, turnover_pct, industry)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      limitDownData.date,
      limitDownData.code,
      limitDownData.name,
      limitDownData.latestPrice,
      limitDownData.changePct,
      limitDownData.amount,
      limitDownData.turnoverPct,
      limitDownData.industry
    );
  }

  batchInsertLimitDown(limitDownArray) {
    const insert = this.db.transaction((items) => {
      for (const item of items) {
        this.insertLimitDown(item);
      }
    });
    return insert(limitDownArray);
  }

  getLimitDownHistory(date) {
    const stmt = this.db.prepare('SELECT * FROM limit_down_history WHERE date = ? ORDER BY change_pct ASC');
    return stmt.all(date);
  }

  // ==================== 板块历史 ====================

  insertSector(sectorData) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sector_history
      (date, sector_code, sector_name, latest_price, change_pct, main_inflow,
       leader_code, leader_name, leader_change_pct)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      sectorData.date,
      sectorData.code,
      sectorData.name,
      sectorData.latestPrice,
      sectorData.changePct,
      sectorData.mainNetInflow,
      sectorData.leaderCode,
      sectorData.leaderName,
      sectorData.leaderChangePct
    );
  }

  batchInsertSector(sectorArray) {
    const insert = this.db.transaction((items) => {
      for (const item of items) {
        this.insertSector(item);
      }
    });
    return insert(sectorArray);
  }

  getSectorHistory(date, sectorCode = null) {
    if (sectorCode) {
      const stmt = this.db.prepare('SELECT * FROM sector_history WHERE date = ? AND sector_code = ?');
      return stmt.get(date, sectorCode);
    } else {
      const stmt = this.db.prepare('SELECT * FROM sector_history WHERE date = ? ORDER BY change_pct DESC');
      return stmt.all(date);
    }
  }

  getSectorByDateRange(startDate, endDate, sectorCode = null) {
    let query = 'SELECT * FROM sector_history WHERE date >= ? AND date <= ?';
    const params = [startDate, endDate];

    if (sectorCode) {
      query += ' AND sector_code = ?';
      params.push(sectorCode);
    }

    query += ' ORDER BY date DESC, change_pct DESC';
    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  // ==================== 指数历史 ====================

  insertIndex(indexData) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO index_history
      (date, index_code, index_name, latest_price, prev_close, change_pct,
       change_amount, amplitude_pct, volume, amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      indexData.date,
      indexData.code,
      indexData.name,
      indexData.latestPrice,
      indexData.prevClose,
      indexData.changePct,
      indexData.changeAmount,
      indexData.amplitudePct,
      indexData.volume,
      indexData.amount
    );
  }

  batchInsertIndex(indexArray) {
    const insert = this.db.transaction((items) => {
      for (const item of items) {
        this.insertIndex(item);
      }
    });
    return insert(indexArray);
  }

  getIndexHistory(date, indexCode = null) {
    if (indexCode) {
      const stmt = this.db.prepare('SELECT * FROM index_history WHERE date = ? AND index_code = ?');
      return stmt.get(date, indexCode);
    } else {
      const stmt = this.db.prepare('SELECT * FROM index_history WHERE date = ?');
      return stmt.all(date);
    }
  }

  // ==================== 竞价数据 ====================

  insertAuction(auctionData) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO auction_data
      (date, code, name, auction_price, auction_change_pct, auction_volume, auction_amount, prev_close)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      auctionData.date,
      auctionData.code,
      auctionData.name,
      auctionData.auctionPrice,
      auctionData.auctionChangePct,
      auctionData.auctionVolume,
      auctionData.auctionAmount,
      auctionData.prevClose
    );
  }

  batchInsertAuction(auctionArray) {
    const insert = this.db.transaction((items) => {
      for (const item of items) {
        this.insertAuction(item);
      }
    });
    return insert(auctionArray);
  }

  getAuctionData(date) {
    const stmt = this.db.prepare('SELECT * FROM auction_data WHERE date = ? ORDER BY auction_change_pct DESC');
    return stmt.all(date);
  }

  getAuctionChanges(date, codes = []) {
    const requestedDate = String(date ?? "").replace(/-/g, "");
    const dateVariants = [requestedDate, requestedDate.length === 8 ? `${requestedDate.slice(0, 4)}-${requestedDate.slice(4, 6)}-${requestedDate.slice(6)}` : ""].filter(Boolean);
    const codeList = [...new Set((codes || []).map((code) => String(code)).filter(Boolean))];
    if (!dateVariants.length || !codeList.length) return [];
    const placeholders = codeList.map(() => "?").join(",");
    const datePlaceholders = dateVariants.map(() => "?").join(",");
    const legacy = this.db.prepare(`
      SELECT code, name, auction_price AS auctionPrice, auction_change_pct AS auctionChangePct,
             auction_volume AS auctionVolume, auction_amount AS auctionAmount, prev_close AS prevClose,
             date, 'auction_data' AS source
      FROM auction_data
      WHERE date IN (${datePlaceholders}) AND code IN (${placeholders})
    `).all(...dateVariants, ...codeList);
    const latest = this.db.prepare(`
      SELECT code, name, auction_price AS auctionPrice, auction_change_pct AS auctionChangePct,
             auction_volume AS auctionVolume, auction_amount AS auctionAmount, prev_close AS prevClose,
             date, source
      FROM auction_snapshots
      WHERE date IN (${datePlaceholders}) AND code IN (${placeholders})
      ORDER BY sampled_at_ms DESC
    `).all(...dateVariants, ...codeList);
    const result = new Map();
    for (const row of [...legacy, ...latest]) if (!result.has(String(row.code))) result.set(String(row.code), row);
    return [...result.values()];
  }

  insertAuctionSnapshot(snapshot) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO auction_snapshots
      (date, sample_time, sampled_at, sampled_at_ms, code, name, auction_price,
       auction_change_pct, auction_volume, auction_amount, prev_close, open, high, low,
       turnover_pct, volume_ratio, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      snapshot.date,
      snapshot.sampleTime,
      snapshot.sampledAt,
      snapshot.sampledAtMs,
      snapshot.code,
      snapshot.name,
      snapshot.auctionPrice,
      snapshot.auctionChangePct,
      snapshot.auctionVolume,
      snapshot.auctionAmount,
      snapshot.prevClose,
      snapshot.open,
      snapshot.high,
      snapshot.low,
      snapshot.turnoverPct,
      snapshot.volumeRatio,
      snapshot.source ?? 'eastmoney'
    );
  }

  batchInsertAuctionSnapshots(snapshots) {
    const insert = this.db.transaction((items) => {
      let inserted = 0;
      for (const item of items) {
        inserted += this.insertAuctionSnapshot(item).changes;
      }
      return inserted;
    });
    return insert(snapshots);
  }

  getAuctionSnapshots(date, code, limit = 2000) {
    const stmt = this.db.prepare(`
      SELECT date, sample_time as sampleTime, sampled_at as sampledAt,
             sampled_at_ms as sampledAtMs, code, name,
             auction_price as auctionPrice, auction_change_pct as auctionChangePct,
             auction_volume as auctionVolume, auction_amount as auctionAmount,
             prev_close as prevClose, open, high, low,
             turnover_pct as turnoverPct, volume_ratio as volumeRatio, source
      FROM auction_snapshots
      WHERE date = ? AND code = ?
      ORDER BY sampled_at_ms ASC
      LIMIT ?
    `);
    return stmt.all(date, code, limit);
  }

  getAuctionSnapshotStats(date) {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as sampleCount, COUNT(DISTINCT code) as stockCount,
             MIN(sampled_at) as firstSampledAt, MAX(sampled_at) as lastSampledAt
      FROM auction_snapshots
      WHERE date = ?
    `);
    return stmt.get(date);
  }

  getIntradayCache(cacheKey) {
    const row = this.db.prepare(`
      SELECT cache_key as cacheKey, date, code, name, payload, updated_at as updatedAt
      FROM intraday_cache WHERE cache_key = ?
    `).get(cacheKey);
    if (!row) return null;
    try { return { ...row, payload: JSON.parse(row.payload) }; } catch { return null; }
  }

  setIntradayCache(cacheKey, date, code, name, payload) {
    this.db.prepare(`
      INSERT INTO intraday_cache (cache_key, date, code, name, payload, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(cache_key) DO UPDATE SET
        date = excluded.date,
        code = excluded.code,
        name = excluded.name,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(cacheKey, date, code, name ?? "", JSON.stringify(payload ?? {}));
    return this.getIntradayCache(cacheKey);
  }

  getMarketManagementCache(cacheKey) {
    const row = this.db.prepare(`
      SELECT cache_key as cacheKey, data_type as dataType, date, code,
             payload, source, updated_at as updatedAt
      FROM market_management_cache WHERE cache_key = ?
    `).get(cacheKey);
    if (!row) return null;
    try { return { ...row, payload: JSON.parse(row.payload) }; } catch { return null; }
  }

  setMarketManagementCache(cacheKey, dataType, date, code, payload, source = "") {
    this.db.prepare(`
      INSERT INTO market_management_cache
        (cache_key, data_type, date, code, payload, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(cache_key) DO UPDATE SET
        data_type = excluded.data_type,
        date = excluded.date,
        code = excluded.code,
        payload = excluded.payload,
        source = excluded.source,
        updated_at = excluded.updated_at
    `).run(cacheKey, dataType, date ?? null, code ?? null, JSON.stringify(payload ?? {}), source ?? "");
    return this.getMarketManagementCache(cacheKey);
  }

  // ==================== 同步日志 ====================

  logSync(dataType, syncDate, recordCount, status, errorMessage = null) {
    const stmt = this.db.prepare(`
      INSERT INTO sync_log (data_type, sync_date, record_count, status, error_message)
      VALUES (?, ?, ?, ?, ?)
    `);

    return stmt.run(dataType, syncDate, recordCount, status, errorMessage);
  }

  getLastSyncDate(dataType) {
    const stmt = this.db.prepare(`
      SELECT sync_date FROM sync_log
      WHERE data_type = ? AND status = 'success'
      ORDER BY sync_date DESC LIMIT 1
    `);
    const result = stmt.get(dataType);
    return result?.sync_date || null;
  }

  getSyncLog(dataType, limit = 100) {
    const stmt = this.db.prepare(`
      SELECT * FROM sync_log
      WHERE data_type = ?
      ORDER BY created_at DESC LIMIT ?
    `);
    return stmt.all(dataType, limit);
  }

  getUiPreferences() {
    const rows = this.db.prepare(`
      SELECT preference_key, preference_value
      FROM ui_preferences
      ORDER BY preference_key
    `).all();
    const preferences = {};
    for (const row of rows) {
      try {
        preferences[row.preference_key] = JSON.parse(row.preference_value);
      } catch {
        preferences[row.preference_key] = row.preference_value;
      }
    }
    return preferences;
  }

  setUiPreferences(preferences) {
    const stmt = this.db.prepare(`
      INSERT INTO ui_preferences (preference_key, preference_value, updated_at)
      VALUES (?, ?, datetime('now', 'localtime'))
      ON CONFLICT(preference_key) DO UPDATE SET
        preference_value = excluded.preference_value,
        updated_at = excluded.updated_at
    `);
    const save = this.db.transaction((entries) => {
      for (const [key, value] of entries) {
        stmt.run(key, JSON.stringify(value));
      }
    });
    save(Object.entries(preferences));
    return this.getUiPreferences();
  }

  // ==================== 统计查询 ====================

  getStockCount() {
    const stmt = this.db.prepare('SELECT COUNT(DISTINCT code) as count FROM stock_kline');
    return stmt.get().count;
  }

  getTradingDates(limit = 100) {
    // 从所有历史数据表中获取交易日，取并集
    const stmt = this.db.prepare(`
      SELECT DISTINCT date FROM (
        SELECT DISTINCT date FROM stock_kline
        UNION
        SELECT DISTINCT date FROM limit_up_history
        UNION
        SELECT DISTINCT date FROM limit_down_history
        UNION
        SELECT DISTINCT date FROM sector_history
        UNION
        SELECT DISTINCT date FROM index_history
      )
      ORDER BY date DESC
      LIMIT ?
    `);
    return stmt.all(limit).map(row => row.date);
  }

  /**
   * Remove market observations while keeping the database schema and UI
   * preferences.  Canonical行情 now lives in stockdb; this is used for the
   * one-time migration reset and is deliberately not called on startup.
   */
  clearMarketData() {
    const tables = [
      'stock_kline',
      'limit_up_history',
      'limit_down_history',
      'sector_history',
      'index_history',
      'auction_data',
      'auction_snapshots',
      'intraday_cache',
      'market_management_cache',
      'sync_log'
    ];
    const counts = {};
    const clear = this.db.transaction(() => {
      for (const table of tables) {
        counts[table] = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
        this.db.exec(`DELETE FROM ${table}`);
      }
    });
    clear();
    return counts;
  }

  close() {
    this.db.close();
  }
}

export default new MarketDatabase();
