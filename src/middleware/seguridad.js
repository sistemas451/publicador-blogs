const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { config } = require('../config');

// Cabeceras de seguridad con política de contenido (CSP) explícita.
function cabeceras() {
  const origenWp = config.wp.url ? [new URL(config.wp.url).origin] : [];
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        styleSrcAttr: ["'unsafe-inline'"], // React usa style="..." en elementos
        imgSrc: ["'self'", 'data:', 'blob:', ...origenWp],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
  });
}

// CORS: solo el origen de la propia aplicación.
function corsLimitado() {
  return cors({ origin: config.appUrl, credentials: true });
}

// Autenticación: 15 intentos por IP cada 15 minutos.
function limiteAuth() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' },
  });
}

module.exports = { cabeceras, corsLimitado, limiteAuth };
