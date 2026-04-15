const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function createViewsService({ dataDir = path.join(__dirname, '..'), logger = console } = {}) {
  const jsonFilePath = path.join(dataDir, 'data', 'views.json');
  const dbFilePath = path.join(dataDir, 'data', 'views.db');
  
  let db;
  let legacyCount = 0;

  async function load() {
    try {
      const dir = path.dirname(dbFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // 1. Read legacy view count if it exists so we don't lose old hits
      if (fs.existsSync(jsonFilePath)) {
        const raw = fs.readFileSync(jsonFilePath, 'utf-8');
        const data = JSON.parse(raw);
        legacyCount = data.count || 0;
        logger.info(`[views] Legacy count of ${legacyCount} preserved from JSON`);
      }

      // 2. Initialize SQLite Database
      db = new Database(dbFilePath);
      db.pragma('journal_mode = WAL'); // Much faster, concurrent writes

      // 3. Create tracking tables
      db.exec(`
        CREATE TABLE IF NOT EXISTS page_views (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ip_address TEXT,
          user_agent TEXT,
          referer TEXT,
          path TEXT,
          accept_language TEXT,
          sec_ch_ua TEXT,
          sec_ch_ua_platform TEXT,
          sec_ch_ua_mobile TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS site_hits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ip_address TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_site_hits_ip_date ON site_hits(ip_address, created_at);
      `);
      
      const currentDbCount = db.prepare('SELECT COUNT(*) AS c FROM page_views').get().c;
      logger.info(`[views] Database ready. Active recorded views: ${currentDbCount}`);
    } catch (err) {
      logger.error('[views] Failed to load views db:', err.message);
    }
  }

  async function increment(meta = {}) {
    if (!db) return getCount();

    const ip = meta.ip || null;
    if (!ip) return getCount();

    try {
      // Check if this IP has already viewed in the last 24 hours
      const recentHit = db.prepare(`
        SELECT id FROM page_views 
        WHERE ip_address = ? 
        AND created_at > datetime('now', '-24 hours') 
        LIMIT 1
      `).get(ip);

      if (!recentHit) {
        const stmt = db.prepare(`
          INSERT INTO page_views (ip_address, user_agent, referer, path, accept_language, sec_ch_ua, sec_ch_ua_platform, sec_ch_ua_mobile)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
          ip,
          meta.userAgent || null,
          meta.referer || null,
          meta.path || '/',
          meta.acceptLanguage || null,
          meta.secChUa || null,
          meta.secChUaPlatform || null,
          meta.secChUaMobile || null
        );
      }
    } catch (err) {
      logger.error('[views] Failed to log view to db:', err.message);
    }

    return getCount();
  }

  function recordHit(ip) {
    if (!db || !ip) return;
    try {
      db.prepare('INSERT INTO site_hits (ip_address) VALUES (?)').run(ip);
    } catch (err) {
      logger.error('[views] Failed to record site hit:', err.message);
    }
  }

  function getDailyHitCount(ip) {
    if (!db || !ip) return 0;
    try {
      // Counts all hits from this IP since the start of the current day (UTC)
      const result = db.prepare(`
        SELECT COUNT(*) AS c FROM site_hits 
        WHERE ip_address = ? 
        AND created_at >= date('now', 'start of day')
      `).get(ip);
      return result.c;
    } catch (err) {
      logger.error('[views] Failed to count daily hits:', err.message);
      return 0;
    }
  }

  function getCount() {
    if (!db) return legacyCount;
    try {
      const result = db.prepare('SELECT COUNT(*) AS c FROM page_views').get();
      return legacyCount + result.c;
    } catch (err) {
      logger.error('[views] Failed to count views:', err.message);
      return legacyCount;
    }
  }

  // SQLite doesn't need flushing like JSON, but closing the DB on exit is good practice
  function flush() {
    if (db) {
      db.close();
      db = null;
    }
  }

  return { load, increment, recordHit, getCount, getDailyHitCount, flush };
}

module.exports = { createViewsService };