// Lista de autores que se pueden elegir al crear un blog. Todos los usuarios la leen; solo el administrador la cambia.
const express = require('express');
const prisma = require('../lib/prisma');
const A = require('../services/auth');

const router = express.Router();
router.use(A.sesion);

const publico = (a) => ({ id: a.id, name: a.name, role: a.role, linkUrl: a.linkUrl, active: a.active });

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

router.post('/', A.admin, async (req, res) => {
  const { error, datos } = leer(req.body);
  if (error) return res.status(400).json({ error });
  res.status(201).json({ author: publico(await prisma.author.create({ data: datos })) });
});

router.patch('/:id', A.admin, async (req, res) => {
  const existe = await prisma.author.findUnique({ where: { id: req.params.id } });
  if (!existe) return res.status(404).json({ error: 'No existe ese autor.' });
  const b = req.body || {};
  const data = {};
  if (typeof b.active === 'boolean') data.active = b.active;
  if (b.name !== undefined) {
    const { error, datos } = leer({ ...existe, ...b });
    if (error) return res.status(400).json({ error });
    Object.assign(data, datos);
  }
  res.json({ author: publico(await prisma.author.update({ where: { id: existe.id }, data })) });
});

module.exports = router;
