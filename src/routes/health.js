const express = require('express');
const router = express.Router();

// Lo usa Railway para saber si el servicio está vivo. No expone nada sensible.
router.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'publicador-blogs', uptime: Math.round(process.uptime()) });
});

module.exports = router;
