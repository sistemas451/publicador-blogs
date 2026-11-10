// Lista de autores que se pueden elegir al crear un blog. Todos los usuarios la leen; solo el administrador la cambia.
// La foto (opcional, campo "foto") se sube a la biblioteca de WordPress y acá se guarda su dirección.
const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const { config } = require('../config');
const A = require('../services/auth');
const wp = require('../services/wordpress');
const { tipoDeImagen } = require('../services/contenido');

const router = express.Router();
router.use(A.sesion);

const publico = (a) => ({ id: a.id, name: a.name, role: a.role, linkUrl: a.linkUrl, photoUrl: a.photoUrl, active: a.active });

const recibirFoto = (req, res, next) =>
  multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxImageMb * 1024 * 1024, files: 1, fields: 8 } }).single('foto')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `La foto puede pesar hasta ${config.maxImageMb} MB.` : 'No se pudo leer el formulario.' });
    next(err);
  });

router.get('/', async (req, res) => {
  const todos = req.user.isAdmin && req.query.todos === '1';
  const lista = await prisma.author.findMany({ where: todos ? {} : { active: true }, orderBy: { name: 'asc' } });
  res.json({ authors: lista.map(publico) });
});

function leer(b = {}) {
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const role = typeof b.role === 'string' ? b.role.trim() : '';
  const linkUrl = typeof b.linkUrl === 'string' ? b.linkUrl.trim() : '';
  if (!name || name.length > 100) return { error: 'Falta el nombre (hasta 100 caracteres).' };
  if (role.length > 100) return { error: 'El cargo es demasiado largo.' };
  if (linkUrl && (linkUrl.length > 300 || !/^https?:\/\//i.test(linkUrl))) return { error: 'El enlace tiene que empezar con http:// o https://' };
  return { datos: { name, role: role || null, linkUrl: linkUrl || null } };
}

// Valida la foto por su contenido y la sube a WordPress. Devuelve null si no vino foto.
async function subirFoto(file) {
  if (!file) return null;
  const t = tipoDeImagen(file.buffer);
  if (!t) throw Object.assign(new Error('La foto tiene que ser un JPG, PNG o WebP válido.'), { status: 400 });
  const r = await wp.subirImagen({ buffer: file.buffer, mime: t.mime, nombre: `autor-${Date.now()}.${t.ext}` });
  return { photoUrl: r.url, photoMediaId: r.id };
}

function manejar(e, res) {
  if (e.status === 400) return res.status(400).json({ error: e.message });
  if (e instanceof wp.ErrorWp) { console.error('Foto de autor:', e.detalle || e.message); return res.status(502).json({ error: e.message }); }
  throw e;
}

router.post('/', A.admin, recibirFoto, async (req, res) => {
  const { error, datos } = leer(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const foto = await subirFoto(req.file);
    try {
      res.status(201).json({ author: publico(await prisma.author.create({ data: { ...datos, ...(foto || {}) } })) });
    } catch (e) {
      if (foto) await wp.borrarMedio(foto.photoMediaId).catch(() => {});
      throw e;
    }
  } catch (e) { manejar(e, res); }
});

router.patch('/:id', A.admin, recibirFoto, async (req, res) => {
  const existe = await prisma.author.findUnique({ where: { id: req.params.id } });
  if (!existe) return res.status(404).json({ error: 'No existe ese autor.' });
  const b = req.body || {};
  const data = {};
  if (b.active !== undefined) {
    if (b.active !== true && b.active !== false && b.active !== 'true' && b.active !== 'false') return res.status(400).json({ error: 'Valor no válido.' });
    data.active = b.active === true || b.active === 'true';
  }
  if (b.name !== undefined) {
    const { error, datos } = leer({ ...existe, ...b });
    if (error) return res.status(400).json({ error });
    Object.assign(data, datos);
  }
  try {
    const foto = await subirFoto(req.file);
    if (foto) Object.assign(data, foto);
    let author;
    try { author = await prisma.author.update({ where: { id: existe.id }, data }); } catch (e) {
      if (foto) await wp.borrarMedio(foto.photoMediaId).catch(() => {});
      throw e;
    }
    // La foto anterior ya no se usa: se borra de WordPress (si falla, queda ahí sin molestar).
    if (foto && existe.photoMediaId) await wp.borrarMedio(existe.photoMediaId).catch(() => {});
    res.json({ author: publico(author) });
  } catch (e) { manejar(e, res); }
});

module.exports = router;
