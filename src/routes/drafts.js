const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const { config } = require('../config');
const A = require('../services/auth');
const wp = require('../services/wordpress');
const { publicar } = require('../services/publicar');
const { Invalido } = require('../services/contenido');

const router = express.Router(); // se monta en /api

// Una publicación a la vez por sesión: un doble clic no crea dos borradores. Va ANTES de verificar la
// sesión en la base (esa consulta tarda un tiempo variable y dejaba pasar al segundo pedido); sin cookie
// no hay nada que bloquear y la verificación de sesión responde 401.
const enCurso = new Set();
function unaALaVez(req, res, next) {
  const clave = req.cookies && req.cookies[A.COOKIE];
  if (!clave) return next();
  if (enCurso.has(clave)) return res.status(409).json({ error: 'Ya hay una publicación en curso. Esperá a que termine.' });
  enCurso.add(clave);
  res.on('close', () => enCurso.delete(clave));
  next();
}

// Recibe el formulario (multipart). Se arma en cada pedido para tomar los límites de la configuración.
const recibir = (req, res, next) => {
  const subida = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxImageMb * 1024 * 1024, files: config.maxImages, fields: 12, fieldSize: 2 * 1024 * 1024, parts: config.maxImages + 12 },
  }).array('imagenes');
  subida(req, res, (err) => {
    if (!err) return next();
    const mensajes = {
      LIMIT_FILE_SIZE: `Cada imagen puede pesar hasta ${config.maxImageMb} MB.`,
      LIMIT_FILE_COUNT: `Se pueden subir hasta ${config.maxImages} imágenes por blog.`,
      LIMIT_UNEXPECTED_FILE: 'Los archivos deben ir en el campo "imagenes".',
      LIMIT_FIELD_VALUE: 'El texto del blog es demasiado largo.',
    };
    if (err instanceof multer.MulterError) return res.status(400).json({ error: mensajes[err.code] || 'No se pudo leer el formulario.' });
    next(err);
  });
};

router.get('/categories', A.sesion, async (req, res) => {
  try {
    res.json({ categories: await wp.categorias() });
  } catch (e) {
    if (!(e instanceof wp.ErrorWp)) throw e;
    console.error('Categorías:', e.detalle || e.message);
    res.status(502).json({ error: e.message });
  }
});

router.get('/drafts', A.sesion, async (req, res) => {
  const lista = await prisma.draft.findMany({
    where: req.user.isAdmin ? {} : { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { user: { select: { name: true } } },
  });
  res.json({
    drafts: lista.map((d) => ({
      id: d.id, title: d.title, status: d.status, wpEditUrl: d.wpEditUrl, wpLink: d.wpLink,
      imageCount: d.imageCount, error: d.status === 'FALLIDO' ? 'No se pudo crear en WordPress.' : null,
      createdAt: d.createdAt, by: d.user.name,
    })),
  });
});

// Campos: title, categoryId, author (opcional), html, featured (opcional: número de la imagen destacada,
// empezando en 0) y los archivos en "imagenes". En el html cada imagen es <img data-imagen="N">.
router.post('/drafts', unaALaVez, A.sesion, recibir, async (req, res) => {
  const b = req.body || {};
  const destacada = b.featured === undefined || b.featured === '' ? null : Number(b.featured);
  try {
    const { draft, advertencias } = await publicar({
      user: req.user,
      titulo: b.title,
      categoriaId: Number(b.categoryId),
      autor: b.author,
      html: b.html,
      archivos: req.files || [],
      destacada: Number.isInteger(destacada) ? destacada : null,
    });
    res.status(201).json({
      draft: { id: draft.id, title: draft.title, wpEditUrl: draft.wpEditUrl, wpLink: draft.wpLink, imageCount: draft.imageCount },
      advertencias,
    });
  } catch (e) {
    if (e instanceof Invalido) return res.status(400).json({ error: e.message });
    if (e instanceof wp.ErrorWp) return res.status(502).json({ error: e.message });
    throw e;
  }
});

module.exports = router;
