// "Guardar en la app": blogs a medio armar, guardados en la base de la app (no van a WordPress). Cada persona ve
// los suyos; el administrador ve todos. Se guarda el texto ya limpio (con las imágenes como marcador data-imagen)
// y las imágenes, validadas por su contenido.
const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const { config } = require('../config');
const A = require('../services/auth');
const { tipoDeImagen, limpiar } = require('../services/contenido');

const router = express.Router();
router.use(A.sesion);

const MAX_GUARDADOS = 30; // por persona

const recibir = (req, res, next) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxImageMb * 1024 * 1024, files: config.maxImages, fields: 12, fieldSize: 2 * 1024 * 1024, parts: config.maxImages + 12 },
  }).array('imagenes')(req, res, (err) => {
    if (!err) return next();
    const mensajes = {
      LIMIT_FILE_SIZE: `Cada imagen puede pesar hasta ${config.maxImageMb} MB.`,
      LIMIT_FILE_COUNT: `Se pueden guardar hasta ${config.maxImages} imágenes por blog.`,
      LIMIT_FIELD_VALUE: 'El texto del blog es demasiado largo.',
    };
    if (err instanceof multer.MulterError) return res.status(400).json({ error: mensajes[err.code] || 'No se pudo leer el formulario.' });
    next(err);
  });

const entero = (v) => (v === undefined || v === '' || v === null ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);

// Lee y valida lo que manda la pantalla. Todo es opcional: se puede guardar a mitad de camino.
function leer(req) {
  const b = req.body || {};
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (title.length > 200) return { error: 'El título puede tener hasta 200 caracteres.' };
  const categoryId = entero(b.categoryId);
  const featured = entero(b.featured);
  if (Number.isNaN(categoryId) || Number.isNaN(featured)) return { error: 'Datos inválidos.' };
  const authorId = typeof b.authorId === 'string' && b.authorId ? b.authorId.slice(0, 40) : null;
  let alts = [];
  try { alts = b.alts ? JSON.parse(b.alts) : []; } catch { return { error: 'Datos inválidos.' }; }
  const archivos = req.files || [];
  const imagenes = [];
  for (const [i, f] of archivos.entries()) {
    const t = tipoDeImagen(f.buffer);
    if (!t) return { error: `La imagen ${i + 1} no es un JPG, PNG o WebP válido.` };
    imagenes.push({ posicion: i, nombre: String(f.originalname || `imagen-${i + 1}.${t.ext}`).slice(0, 120), mime: t.mime, alt: String(alts[i] || '').slice(0, 200), datos: f.buffer });
  }
  if (featured !== null && !imagenes[featured]) return { error: 'La imagen destacada elegida no existe.' };
  const html = limpiar(typeof b.html === 'string' ? b.html : '');
  return { datos: { title, categoryId, authorId, html, featured }, imagenes };
}

const puede = (req, g) => g && (g.userId === req.user.id || req.user.isAdmin);

router.get('/', async (req, res) => {
  const lista = await prisma.guardado.findMany({
    where: req.user.isAdmin ? {} : { userId: req.user.id },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, updatedAt: true, createdAt: true, user: { select: { name: true } }, _count: { select: { imagenes: true } } },
  });
  res.json({ guardados: lista.map((g) => ({ id: g.id, title: g.title, updatedAt: g.updatedAt, createdAt: g.createdAt, by: g.user.name, imagenes: g._count.imagenes })) });
});

router.get('/:id', async (req, res) => {
  const g = await prisma.guardado.findUnique({ where: { id: req.params.id }, include: { imagenes: { select: { posicion: true, nombre: true, mime: true, alt: true }, orderBy: { posicion: 'asc' } } } });
  if (!puede(req, g)) return res.status(404).json({ error: 'No existe ese guardado.' });
  res.json({ guardado: { id: g.id, title: g.title, categoryId: g.categoryId, authorId: g.authorId, html: g.html, featured: g.featured, updatedAt: g.updatedAt, imagenes: g.imagenes } });
});

router.get('/:id/imagenes/:pos', async (req, res) => {
  const g = await prisma.guardado.findUnique({ where: { id: req.params.id }, select: { userId: true } });
  if (!puede(req, g)) return res.status(404).json({ error: 'No existe.' });
  const im = await prisma.guardadoImagen.findUnique({ where: { guardadoId_posicion: { guardadoId: req.params.id, posicion: Number(req.params.pos) || 0 } } });
  if (!im) return res.status(404).json({ error: 'No existe.' });
  res.set({ 'Content-Type': im.mime, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' });
  res.send(Buffer.from(im.datos));
});

router.post('/', recibir, async (req, res) => {
  const { error, datos, imagenes } = leer(req);
  if (error) return res.status(400).json({ error });
  if ((await prisma.guardado.count({ where: { userId: req.user.id } })) >= MAX_GUARDADOS) {
    return res.status(400).json({ error: `Ya tenés ${MAX_GUARDADOS} blogs guardados: enviá o borrá alguno antes de guardar otro.` });
  }
  const g = await prisma.guardado.create({ data: { ...datos, userId: req.user.id, imagenes: { create: imagenes } } });
  res.status(201).json({ guardado: { id: g.id, updatedAt: g.updatedAt } });
});

// Reemplaza todo (texto e imágenes) por lo que se manda ahora.
router.put('/:id', recibir, async (req, res) => {
  const g = await prisma.guardado.findUnique({ where: { id: req.params.id }, select: { userId: true } });
  if (!puede(req, g)) return res.status(404).json({ error: 'No existe ese guardado.' });
  const { error, datos, imagenes } = leer(req);
  if (error) return res.status(400).json({ error });
  const [, act] = await prisma.$transaction([
    prisma.guardadoImagen.deleteMany({ where: { guardadoId: req.params.id } }),
    prisma.guardado.update({ where: { id: req.params.id }, data: { ...datos, imagenes: { create: imagenes } } }),
  ]);
  res.json({ guardado: { id: act.id, updatedAt: act.updatedAt } });
});

router.delete('/:id', async (req, res) => {
  const g = await prisma.guardado.findUnique({ where: { id: req.params.id }, select: { userId: true } });
  if (!puede(req, g)) return res.status(404).json({ error: 'No existe ese guardado.' });
  await prisma.guardado.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
