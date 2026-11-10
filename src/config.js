// Lee las variables de entorno una sola vez. .env solo se usa si existe (en Railway no hay archivo).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const num = (v, def) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : def);
const isProd = process.env.NODE_ENV === 'production';
const port = num(process.env.PORT, 3000);

const config = {
  isProd,
  port,
  appUrl: (process.env.APP_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || '',
  wp: {
    url: (process.env.WP_URL || '').replace(/\/$/, ''),
    user: process.env.WP_USER || '',
    appPassword: process.env.WP_APP_PASSWORD || '',
    tagSlug: process.env.WP_TAG_SLUG || 'publicador',
  },
  resend: { apiKey: process.env.RESEND_API_KEY || '', from: process.env.RESEND_FROM || '' },
  maxImageMb: num(process.env.MAX_IMAGE_MB, 5),
  maxImages: num(process.env.MAX_IMAGES, 10),
};

// En desarrollo, si falta JWT_SECRET se usa uno al azar (las sesiones se pierden al reiniciar).
if (!isProd && config.jwtSecret.length < 32) {
  config.jwtSecret = crypto.randomBytes(32).toString('hex');
  if (process.env.NODE_TEST_CONTEXT === undefined) console.warn('Aviso: JWT_SECRET no definido; se usa un secreto temporal de desarrollo.');
}

// Orígenes desde los que se aceptan pedidos (en desarrollo, también el servidor de Vite).
config.origenesPermitidos = [config.appUrl, ...(isProd ? [] : ['http://localhost:5173'])];

// En producción el servidor no arranca sin lo imprescindible (nunca con un secreto vacío o corto).
function validarProduccion() {
  const faltan = [];
  if (!config.databaseUrl) faltan.push('DATABASE_URL');
  if (config.jwtSecret.length < 32) faltan.push('JWT_SECRET (mínimo 32 caracteres)');
  if (!process.env.APP_URL) faltan.push('APP_URL');
  if (faltan.length) throw new Error('Faltan variables obligatorias: ' + faltan.join(', '));
}

module.exports = { config, validarProduccion };
