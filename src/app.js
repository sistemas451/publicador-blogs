const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { config } = require('./config');
const { cabeceras, corsLimitado, origenPropio, limiteAuth } = require('./middleware/seguridad');

// `limiteIntentos` solo se cambia en las pruebas.
function createApp({ limiteIntentos = 15 } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.isProd) app.set('trust proxy', 1); // detrás del proxy de Railway: IP real para el límite de intentos

  app.use(cabeceras());
  app.use(corsLimitado());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api', origenPropio);

  app.use('/api/health', require('./routes/health'));
  app.use('/api/auth', limiteAuth(limiteIntentos), require('./routes/auth'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api', require('./routes/drafts'));

  app.use('/api', (req, res) => res.status(404).json({ error: 'No existe.' }));

  // Pantalla mínima en HTML plano (public/). En la Fase 4 la reemplaza la de Vite (client/dist).
  const carpeta = path.join(__dirname, '..', 'public');
  app.use(express.static(carpeta));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(carpeta, 'index.html')));

  // Manejo de errores: nunca devuelve el detalle interno.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    const cliente = err.status && err.status < 500;
    res.status(cliente ? err.status : 500).json({ error: cliente ? err.message : 'Error interno.' });
  });
  return app;
}

module.exports = { createApp };
