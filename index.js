require('dotenv').config();

const express = require('express');
const http = require('http');
const net = require('net');
const path = require('path');
const url = require('url');

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

function isAbsoluteProxyTarget(reqUrl) {
  return /^https?:\/\//i.test(reqUrl || '');
}

function isHttpsRequest(req) {
  const forwardedProtoRaw = req.headers['x-forwarded-proto'];
  const forwardedProto = Array.isArray(forwardedProtoRaw)
    ? forwardedProtoRaw[0]
    : String(forwardedProtoRaw || '').split(',')[0].trim();

  if (forwardedProto.toLowerCase() === 'https') return true;

  return Boolean(req.socket && req.socket.encrypted);
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

    if (config.forceHttps && !isHttpsRequest(req)) {
      const host = req.headers.host;
      if (host) {
        res.writeHead(301, { Location: `https://${host}${reqUrl}` });
        res.end();
        return;
      }
    }

    if (isApiRoute(reqUrl, req.method || 'GET')) {
      apiApp(req, res);
      return;
    }

    siteApp(req, res);
  });

  // ── Proxy server (HTTP forward + HTTPS CONNECT) ──────────────────

  function verifyProxyAuth(req) {
    if (!config.proxyAuth) return true;

    const authHeader = req.headers['proxy-authorization'];
    if (!authHeader) return false;

    const match = /^Basic\s+(.+)$/i.exec(authHeader);
    if (!match) return false;

    const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
    return decoded === config.proxyAuth;
  }

  function sendProxyAuthRequired(res) {
    res.writeHead(407, {
      'Proxy-Authenticate': 'Basic realm="mehro-proxy"',
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({ ok: false, error: 'Proxy authentication required' }));
  }

  const proxyServer = http.createServer((req, res) => {
    const reqUrl = req.url || '/';

    if (!verifyProxyAuth(req)) {
      sendProxyAuthRequired(res);
      return;
    }

    if (!isAbsoluteProxyTarget(reqUrl)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Proxy requires an absolute URL' }));
      return;
    }

    logger(`Proxy HTTP: ${reqUrl}`);

    const target = url.parse(reqUrl);
    if (!target.hostname) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid proxy request URL' }));
      return;
    }

    const proxyHeaders = Object.assign({}, req.headers);
    delete proxyHeaders['proxy-authorization'];

    const options = {
      hostname: target.hostname,
      port: target.port || 80,
      path: target.path,
      method: req.method,
      headers: proxyHeaders,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (error) => {
      logger(`HTTP Error: ${error.message}`);
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });

    req.pipe(proxyReq);
  });

  proxyServer.on('connect', (req, clientSocket, head) => {
    if (!verifyProxyAuth(req)) {
      clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\n' +
                         'Proxy-Authenticate: Basic realm="mehro-proxy"\r\n' +
                         '\r\n');
      clientSocket.end();
      return;
    }

    const { port: reqPort, hostname } = url.parse(`//${req.url}`, false, true);
    logger(`Proxy HTTPS: ${hostname}:${reqPort || 443}`);

    const serverSocket = net.connect(reqPort || 443, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                         'Proxy-agent: mehro-proxy\r\n' +
                         '\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', () => {
      clientSocket.end();
    });

    clientSocket.on('error', () => {
      serverSocket.end();
    });
  });

  // ── Start both servers ───────────────────────────────────────────

  webServer.listen(config.port, () => {
    console.log('============ MEHRO SITE + BOT ========================');
    console.log(`[site]  http://127.0.0.1:${config.port}/`);
    console.log(`[api]   http://127.0.0.1:${config.port}/health`);
    console.log(`[api]   http://127.0.0.1:${config.port}/api/presence`);
    console.log(`[config] FORCE_HTTPS=${config.forceHttps}`);
    console.log('======================================================');
  });

  proxyServer.listen(config.proxyPort, () => {
    console.log('============ MEHRO PROXY =============================');
    console.log(`[proxy] http://127.0.0.1:${config.proxyPort}/`);
    console.log(`[proxy] Auth: ${config.proxyAuth ? 'ENABLED' : 'DISABLED (open!)'}`);
    console.log('======================================================');
  });

  // ── Graceful shutdown ────────────────────────────────────────────

  const shutdown = async (signal) => {
    console.log(`[server] Received ${signal}, shutting down...`);

    let closed = 0;
    const onClosed = async () => {
      closed += 1;
      if (closed < 2) return;
      viewsService.flush();
      await presenceService.stop();
      console.log('[server] Shutdown complete');
      process.exit(0);
    };

    webServer.close(onClosed);
    proxyServer.close(onClosed);

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
