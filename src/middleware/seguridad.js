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
const corsLimitado = () => cors({ origin: config.origenesPermitidos, credentials: true });

// Defensa extra contra pedidos disparados desde otro sitio: si un pedido que modifica datos
// trae un Origin y no es el de la aplicación, se rechaza (la cookie ya es SameSite=Strict).
function origenPropio(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origen = req.get('origin');
    if (origen && !config.origenesPermitidos.includes(origen)) return res.status(403).json({ error: 'Origen no permitido.' });
  }
  next();
}

// Autenticación: por defecto 15 intentos por IP cada 15 minutos.
function limiteAuth(limite = 15) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: limite,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' },
  });
}

module.exports = { cabeceras, corsLimitado, origenPropio, limiteAuth };
