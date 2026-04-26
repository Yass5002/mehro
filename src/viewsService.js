const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const INCIDENT_BAN_MIGRATION_KEY = 'incident-2026-04-25-datacenter-abuse';
const INCIDENT_BAN_TARGET_DATE = '2026-04-25';
const INCIDENT_BAN_REASON = 'abuse';

function normalizeIp(rawValue) {
  if (!rawValue) return null;

  const candidate = String(rawValue).split(',')[0].trim();
  if (!candidate) return null;

  // IPv4 mapped IPv6 addresses should map to their IPv4 form.
  if (candidate.startsWith('::ffff:')) {
    return candidate.slice(7);
  }

  return candidate;
}

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

        CREATE TABLE IF NOT EXISTS banned_ips (
          ip_address TEXT PRIMARY KEY,
          reason TEXT NOT NULL,
          source TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS view_migrations (
          migration_key TEXT PRIMARY KEY,
          details TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_site_hits_ip_date ON site_hits(ip_address, created_at);
        CREATE INDEX IF NOT EXISTS idx_page_views_ip_date ON page_views(ip_address, created_at);
        CREATE INDEX IF NOT EXISTS idx_banned_ips_created_at ON banned_ips(created_at);
      `);

      applyIncidentBanIfNeeded();
      
      const currentDbCount = db.prepare('SELECT COUNT(*) AS c FROM page_views').get().c;
      logger.info(`[views] Database ready. Active recorded views: ${currentDbCount}`);
    } catch (err) {
      logger.error('[views] Failed to load views db:', err.message);
    }
  }

  async function increment(meta = {}) {
    if (!db) return getCount();

    const ip = normalizeIp(meta.ip);
    if (!ip) return getCount();

    try {
      if (isBannedIp(ip)) {
        return getCount();
      }

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
    if (!db) return;

    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp || isBannedIp(normalizedIp)) return;

    try {
      db.prepare('INSERT INTO site_hits (ip_address) VALUES (?)').run(normalizedIp);
    } catch (err) {
      logger.error('[views] Failed to record site hit:', err.message);
    }
  }

  function getDailyHitCount(ip) {
    if (!db) return 0;

    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp || isBannedIp(normalizedIp)) return 0;

    try {
      // Counts all hits from this IP since the start of the current day (UTC)
      const result = db.prepare(`
        SELECT COUNT(*) AS c FROM site_hits 
        WHERE ip_address = ? 
        AND created_at >= date('now', 'start of day')
      `).get(normalizedIp);
      return result.c;
    } catch (err) {
      logger.error('[views] Failed to count daily hits:', err.message);
      return 0;
    }
  }

  function isBannedIp(ip) {
    if (!db || !ip) return false;
    try {
      const row = db.prepare('SELECT 1 FROM banned_ips WHERE ip_address = ? LIMIT 1').get(ip);
      return Boolean(row);
    } catch (err) {
      logger.error('[views] Failed to check banned IP:', err.message);
      return false;
    }
  }

  function applyIncidentBanIfNeeded() {
    const migration = db
      .prepare('SELECT migration_key FROM view_migrations WHERE migration_key = ? LIMIT 1')
      .get(INCIDENT_BAN_MIGRATION_KEY);

    if (migration) {
      logger.info(`[views] Migration already applied: ${INCIDENT_BAN_MIGRATION_KEY}`);
      return;
    }

    const applyMigration = db.transaction(() => {
      const incidentIps = db
        .prepare(`
          SELECT DISTINCT ip_address
          FROM page_views
          WHERE ip_address IS NOT NULL
            AND TRIM(ip_address) <> ''
            AND date(created_at, 'localtime') = ?
        `)
        .all(INCIDENT_BAN_TARGET_DATE)
        .map((row) => normalizeIp(row.ip_address))
        .filter(Boolean);

      const uniqueIps = [...new Set(incidentIps)];

      const insertBanStmt = db.prepare(`
        INSERT INTO banned_ips (ip_address, reason, source)
        VALUES (?, ?, ?)
        ON CONFLICT(ip_address) DO UPDATE SET
          reason = excluded.reason,
          source = excluded.source
      `);

      for (const ip of uniqueIps) {
        insertBanStmt.run(ip, INCIDENT_BAN_REASON, INCIDENT_BAN_MIGRATION_KEY);
      }

      const deleteFromPageViews = db.prepare(`
        DELETE FROM page_views
        WHERE ip_address IN (
          SELECT ip_address FROM banned_ips WHERE source = ?
        )
      `).run(INCIDENT_BAN_MIGRATION_KEY).changes;

      const deleteFromSiteHits = db.prepare(`
        DELETE FROM site_hits
        WHERE ip_address IN (
          SELECT ip_address FROM banned_ips WHERE source = ?
        )
      `).run(INCIDENT_BAN_MIGRATION_KEY).changes;

      const details = JSON.stringify({
        reason: INCIDENT_BAN_REASON,
        source: INCIDENT_BAN_MIGRATION_KEY,
        targetDate: INCIDENT_BAN_TARGET_DATE,
        bannedIps: uniqueIps.length,
        deletedPageViews: deleteFromPageViews,
        deletedSiteHits: deleteFromSiteHits,
      });

      db.prepare('INSERT INTO view_migrations (migration_key, details) VALUES (?, ?)').run(
        INCIDENT_BAN_MIGRATION_KEY,
        details,
      );

      return {
        bannedIps: uniqueIps.length,
        deletedPageViews: deleteFromPageViews,
        deletedSiteHits: deleteFromSiteHits,
      };
    });

    const summary = applyMigration();
    logger.info(
      `[views] Applied ${INCIDENT_BAN_MIGRATION_KEY}. Banned ${summary.bannedIps} IPs, ` +
      `deleted ${summary.deletedPageViews} page views and ${summary.deletedSiteHits} site hits.`,
    );
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

  return { load, increment, recordHit, getCount, getDailyHitCount, isBannedIp, flush };
}

module.exports = { createViewsService };