const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

function createServer({ config, presenceService, viewsService, logger = console }) {
  const app = express();

  // Trust the first hop (Caddy reverse proxy) so rate limiters and req.ip use the real client IP
  app.set('trust proxy', 1);

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.allowedOrigins.length === 0) return callback(null, true);
        if (config.allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Origin not allowed by CORS'));
      },
      methods: ['GET', 'POST', 'OPTIONS'],
    }),
  );

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      logger.info(`[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`);
    });
    next();
  });

  app.get('/health', (req, res) => {
    res.status(200).json({
      ok: true,
      service: 'discord-now-playing-api',
      discordReady: presenceService.isReady(),
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/sys', (req, res) => {
    const mem = process.memoryUsage();
    res.status(200).json({
      ok: true,
      uptimeSec: Math.round(process.uptime()),
      memory: {
        rss: `${Math.round(mem.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
        external: `${Math.round(mem.external / 1024 / 1024)} MB`
      }
    });
  });

  app.get('/api/now-playing', async (req, res, next) => {
    try {
      if (!presenceService.isReady()) {
        return res.status(503).json({
          ok: false,
          error: 'Discord client is not ready',
        });
      }

      const nowPlaying = await Promise.race([
        presenceService.getNowPlaying(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Presence request timeout')), config.requestTimeoutMs),
        ),
      ]);

      return res.status(200).json({ ok: true, data: nowPlaying });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/presence', async (req, res, next) => {
    try {
      if (!presenceService.isReady()) {
        return res.status(503).json({
          ok: false,
          error: 'Discord client is not ready',
        });
      }

      const presence = await Promise.race([
        presenceService.getPresenceSnapshot(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Presence request timeout')), config.requestTimeoutMs),
        ),
      ]);

      return res.status(200).json({ ok: true, data: presence });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/views', (req, res) => {
    res.status(200).json({ ok: true, count: viewsService.getCount() });
  });

  app.post('/api/views', async (req, res, next) => {
    try {
      const meta = {
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        referer: req.headers.referer || req.headers.referrer,
        path: req.originalUrl,
        acceptLanguage: req.headers['accept-language'],
        secChUa: req.headers['sec-ch-ua'],
        secChUaPlatform: req.headers['sec-ch-ua-platform'],
        secChUaMobile: req.headers['sec-ch-ua-mobile'],
      };
      const nextCount = await viewsService.increment(meta);
      return res.status(200).json({ ok: true, count: nextCount });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/', async (req, res, next) => {
    try {
      const meta = {
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        referer: req.headers.referer || req.headers.referrer,
        path: req.originalUrl,
        acceptLanguage: req.headers['accept-language'],
        secChUa: req.headers['sec-ch-ua'],
        secChUaPlatform: req.headers['sec-ch-ua-platform'],
        secChUaMobile: req.headers['sec-ch-ua-mobile'],
      };
      const nextCount = await viewsService.increment(meta);
      return res.status(200).json({ count: nextCount });
    } catch (error) {
      return next(error);
    }
  });

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: 'Route not found' });
  });

  app.use((error, req, res, _next) => {
    logger.error('[http] Unhandled error:', error.message);

    if (error.message === 'Origin not allowed by CORS') {
      return res.status(403).json({ ok: false, error: error.message });
    }

    if (error.message === 'Presence request timeout') {
      return res.status(504).json({ ok: false, error: error.message });
    }

    return res.status(500).json({ ok: false, error: 'Internal server error' });
  });

  return app;
}

module.exports = { createServer };
