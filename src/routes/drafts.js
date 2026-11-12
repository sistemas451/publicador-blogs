const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const { config } = require('../config');
const A = require('../services/auth');
const wp = require('../services/wordpress');
const { publicar } = require('../services/publicar');
const { Invalido, limpiar } = require('../services/contenido');
const linkedin = require('../services/linkedin');

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
    res.json({ categories: await wp.categorias(), limits: { maxImages: config.maxImages, maxImageMb: config.maxImageMb } });
  } catch (e) {
    if (!(e instanceof wp.ErrorWp)) throw e;
    console.error('Categorías:', e.detalle || e.message);
    res.status(502).json({ error: e.message });
  }
});

// Vista previa: devuelve el HTML ya limpiado con la MISMA regla que usa la publicación, así lo que se ve es lo que se envía.
router.post('/preview', A.sesion, (req, res) => {
  const { html } = req.body || {};
  if (typeof html !== 'string' || html.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'No hay texto para mostrar.' });
  res.json({ html: limpiar(html) });
});

// Traer desde LinkedIn: lee los datos públicos del posteo (ver services/linkedin.js). Como mucho un pedido cada
// 5 segundos por usuario, para no mandarle a LinkedIn pedidos de más.
const ultimoLinkedin = new Map();
router.post('/linkedin', A.sesion, async (req, res) => {
  const ahora = Date.now();
  if (ahora - (ultimoLinkedin.get(req.user.id) || 0) < 5000) return res.status(429).json({ error: 'Esperá unos segundos antes de traer otro posteo.' });
  ultimoLinkedin.set(req.user.id, ahora);
  try {
    res.json(await linkedin.traer((req.body || {}).url));
  } catch (e) {
    if (e instanceof linkedin.ErrorLinkedin) return res.status(e.status).json({ error: e.message });
    console.error('LinkedIn:', e.message);
    res.status(502).json({ error: 'No se pudo leer el posteo de LinkedIn. Cargalo a mano.' });
  }
});

router.get('/drafts', A.sesion, async (req, res) => {
  const lista = await prisma.draft.findMany({
    where: req.user.isAdmin ? {} : { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { user: { select: { name: true } } },
  });
  // Estado actual en WordPress (en borrador, publicado, en la papelera o borrado). Si WordPress no responde, la
  // lista sale igual, sin el estado.
  let estados = null;
  try {
    estados = await wp.estados(lista.filter((d) => d.wpPostId).map((d) => d.wpPostId));
  } catch (e) {
    console.error('Estado de los borradores:', e.detalle || e.message);
  }
  res.json({
    drafts: lista.map((d) => {
      const e = d.wpPostId && estados ? estados.get(d.wpPostId) || { estado: 'borrado' } : null;
      return {
        id: d.id, title: d.title, status: d.status, wpEditUrl: d.wpEditUrl,
        imageCount: d.imageCount, error: d.status === 'FALLIDO' ? 'No se pudo crear en WordPress.' : null,
        createdAt: d.createdAt, by: d.user.name,
        wpEstado: e ? e.estado : null, // publish | future | draft | pending | private | trash | borrado | null (no se sabe)
        wpLink: e && e.estado === 'publish' ? e.link : null,
      };
    }),
  });
});

// Campos: title, categoryId, authorId (id de un autor de /api/authors), html, featured (opcional: número de la imagen destacada,
// empezando en 0) y los archivos en "imagenes". En el html cada imagen es <img data-imagen="N">.
router.post('/drafts', unaALaVez, A.sesion, recibir, async (req, res) => {
  const b = req.body || {};
  const destacada = b.featured === undefined || b.featured === '' ? null : Number(b.featured);
  try {
    const { draft, advertencias } = await publicar({
      user: req.user,
      titulo: b.title,
      categoriaId: Number(b.categoryId),
      autorId: b.authorId,
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
