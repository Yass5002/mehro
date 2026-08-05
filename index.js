require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');

const { getConfig } = require('./src/config');
const { createDiscordPresenceService } = require('./src/discordPresenceService');
const { createServer } = require('./src/server');
const { createViewsService } = require('./src/viewsService');

function logger(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function isApiRoute(reqUrl, method) {
  return reqUrl === '/health' || reqUrl.startsWith('/api/') || (reqUrl === '/' && method === 'POST');
}

function isHttpsRequest(req) {
  const forwardedProtoRaw = req.headers['x-forwarded-proto'];
  const forwardedProto = Array.isArray(forwardedProtoRaw)
    ? forwardedProtoRaw[0]
    : String(forwardedProtoRaw || '').split(',')[0].trim();

  if (forwardedProto.toLowerCase() === 'https') return true;

  return Boolean(req.socket && req.socket.encrypted);
}

function normalizeHostHeader(hostHeader) {
  if (!hostHeader) return '';
  return Array.isArray(hostHeader) ? String(hostHeader[0] || '').trim() : String(hostHeader).trim();
}

function toCanonicalHost(hostHeader) {
  if (!hostHeader) return '';
  return hostHeader.replace(/^www\.mehro\.me(?::(\d+))?$/i, (_match, port) =>
    port ? `mehro.me:${port}` : 'mehro.me',
  );
}

async function main() {
  const config = getConfig();
  const siteRoot = __dirname;

  const presenceService = createDiscordPresenceService({
    token: config.discord.token,
    userId: config.discord.userId,
    serverId: config.discord.serverId,
  });

  const viewsService = createViewsService();

  await presenceService.start();
  await viewsService.load();

  const apiApp = createServer({ config, presenceService, viewsService });

  const siteApp = express();
  siteApp.use(express.static(siteRoot, { extensions: ['html'] }));
  siteApp.get('/', (req, res) => {
    res.sendFile(path.join(siteRoot, 'index.html'));
  });

  // ── Web server (site + API) ──────────────────────────────────────

  const webServer = http.createServer((req, res) => {
    const reqUrl = req.url || '/';
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const acceptLanguage = req.headers['accept-language'] || '';

    const isHttps = isHttpsRequest(req);
    const hostHeader = normalizeHostHeader(req.headers.host);
    const canonicalHost = toCanonicalHost(hostHeader);
    const needsHostRedirect = Boolean(hostHeader) && canonicalHost !== hostHeader;
    const needsHttpsRedirect = config.forceHttps && !isHttps;

    if ((needsHostRedirect || needsHttpsRedirect) && canonicalHost) {
      const protocol = config.forceHttps || isHttps ? 'https' : 'http';
      res.writeHead(301, { Location: `${protocol}://${canonicalHost}${reqUrl}` });
      res.end();
      return;
    }

    if (isApiRoute(reqUrl, req.method || 'GET')) {
      apiApp(req, res);
      return;
    }

    siteApp(req, res);
  });

  // ── Start web server ─────────────────────────────────────────────

  webServer.listen(config.port, () => {
    console.log('============ MEHRO SITE + BOT ========================');
    console.log(`[site]  http://127.0.0.1:${config.port}/`);
    console.log(`[api]   http://127.0.0.1:${config.port}/health`);
    console.log(`[api]   http://127.0.0.1:${config.port}/api/presence`);
    console.log(`[config] FORCE_HTTPS=${config.forceHttps}`);
    console.log('======================================================');
  });

  // ── Graceful shutdown ────────────────────────────────────────────

  const shutdown = async (signal) => {
    console.log(`[server] Received ${signal}, shutting down...`);

    webServer.close(async () => {
      viewsService.flush();
      await presenceService.stop();
      console.log('[server] Shutdown complete');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('[server] Forced shutdown due to timeout');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[server] Fatal startup error:', error.message);
  process.exit(1);
});
