const crypto = require('crypto');
const express = require('express');
const prisma = require('../lib/prisma');
const { config } = require('../config');
const A = require('../services/auth');
const mail = require('../services/mail');

const router = express.Router();
router.use(A.sesion, A.admin); // todo esto es solo para el administrador

const conEstado = (u) => ({ ...A.publico(u), pendiente: !u.passwordChangedAt, creado: u.createdAt });

router.get('/', async (req, res) => {
  const lista = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  res.json({ users: lista.map(conEstado) });
});

// Invita a alguien: crea el usuario sin contraseña y le manda el enlace. Reinvitar a alguien pendiente genera un enlace nuevo.
router.post('/invite', async (req, res) => {
  const { email, name } = req.body || {};
  const correo = A.normalizarEmail(email);
  if (!A.emailValido(correo)) return res.status(400).json({ error: 'El correo no es válido.' });
  if (typeof name !== 'string' || !name.trim() || name.length > 100) return res.status(400).json({ error: 'Falta el nombre.' });

  let user = await prisma.user.findUnique({ where: { email: correo } });
  if (user && user.passwordChangedAt) return res.status(409).json({ error: 'Ese correo ya tiene un usuario.' });
  if (!user) {
    // Contraseña al azar que nadie conoce: no se puede entrar hasta aceptar la invitación.
    const sinClave = await A.hashPassword(crypto.randomBytes(32).toString('hex'));
    user = await prisma.user.create({ data: { email: correo, name: name.trim(), passwordHash: sinClave } });
  } else {
    user = await prisma.user.update({ where: { id: user.id }, data: { name: name.trim(), active: true } });
  }
  const token = await A.crearToken(user.id, 'INVITE');
  try {
    await mail.enviar({
      para: user.email,
      asunto: 'Te invitaron al Publicador de blogs de Myselec',
      titulo: `Hola ${user.name}`,
      parrafos: ['Te invitaron a usar el Publicador de blogs de Myselec, para cargar los blogs como borrador en la web.', 'Elegí tu contraseña con el botón de abajo. El enlace sirve una sola vez y vence en 48 horas.'],
      boton: 'Elegir mi contraseña',
      enlace: `${config.appUrl}/aceptar-invitacion?token=${token}`,
    });
  } catch (e) {
    console.error('No se pudo enviar la invitación:', e.message);
    return res.status(502).json({ error: 'Se creó el usuario pero no se pudo enviar el mail. Probá invitarlo de nuevo.' });
  }
  res.status(201).json({ user: conEstado(user) });
});

// Activar o desactivar. Desactivar corta la sesión en el siguiente pedido.
router.patch('/:id', async (req, res) => {
  const { active } = req.body || {};
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'Falta indicar si queda activo.' });
  if (req.params.id === req.user.id && !active) return res.status(400).json({ error: 'No podés desactivarte a vos mismo.' });
  const existe = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existe) return res.status(404).json({ error: 'No existe ese usuario.' });
  const user = await prisma.user.update({ where: { id: existe.id }, data: { active } });
  res.json({ user: conEstado(user) });
});

module.exports = router;
