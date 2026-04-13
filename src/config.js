const requiredVars = ['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID', 'DISCORD_SERVER_ID'];

function normalizePort(input, fallback = 3001) {
  const parsed = Number.parseInt(String(input ?? ''), 10);
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 65535) return fallback;
  return parsed;
}

function normalizePositiveInt(input, fallback) {
  const parsed = Number.parseInt(String(input ?? ''), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseAllowedOrigins(originList) {
  if (!originList || !originList.trim()) return [];
  return originList
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseBoolean(input, fallback = false) {
  if (input === undefined || input === null || String(input).trim() === '') return fallback;
  const normalized = String(input).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function getConfig(env = process.env) {
  const missing = requiredVars.filter((name) => !env[name] || !String(env[name]).trim());

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    nodeEnv: env.NODE_ENV || 'development',
    port: normalizePort(env.SERVER_PORT ?? env.PORT, 3001),
    proxyPort: normalizePort(env.PROXY_PORT, 3002),
    proxyAuth: env.PROXY_AUTH || null,
    discord: {
      token: env.DISCORD_BOT_TOKEN,
      userId: env.DISCORD_USER_ID,
      serverId: env.DISCORD_SERVER_ID,
    },
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    requestTimeoutMs: normalizePositiveInt(env.REQUEST_TIMEOUT_MS, 8000),
    forceHttps: parseBoolean(env.FORCE_HTTPS, false),
  };
}

module.exports = { getConfig };
