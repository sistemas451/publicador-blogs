const { config, validarProduccion } = require('./config');
const { createApp } = require('./app');

if (config.isProd) validarProduccion();
createApp().listen(config.port, () => {
  console.log(`Publicador de blogs escuchando en el puerto ${config.port} (${config.isProd ? 'producción' : 'desarrollo'})`);
});
