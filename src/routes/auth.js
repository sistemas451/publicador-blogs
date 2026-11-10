const express = require('express');
const prisma = require('../lib/prisma');
const { config } = require('../config');
const A = require('../services/auth');
const mail = require('../services/mail');

const router = express.Router();
const texto = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

// Mismo mensaje para "no existe", "clave mal" y "desactivado": no se revela cuál de las tres es.
const CREDENCIALES = 'Correo o contraseña incorrectos.';

async function registrarIngreso(req, email, userId, success) {
  await prisma.loginLog.create({
    data: { email: email.slice(0, 254), userId: userId || null, success, ip: req.ip || null, userAgent: (req.get('user-agent') || '').slice(0, 300) },
  });
  // Se borra lo de más de 90 días en cada ingreso (sin esperar el resultado).
  prisma.loginLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 24 * 3600 * 1000) } } }).catch(() => {});
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!texto(email, 254) || !texto(password, 200)) return res.status(400).json({ error: 'Completá el correo y la contraseña.' });
  const correo = A.normalizarEmail(email);
  const user = await prisma.user.findUnique({ where: { email: correo } });
  const ok = await A.verificar(password, user && user.passwordHash);
  if (!user || !user.active || !ok) {
    await registrarIngreso(req, correo, user && user.id, false);
    return res.status(401).json({ error: CREDENCIALES });
  }
  await registrarIngreso(req, correo, user.id, true);
  res.cookie(A.COOKIE, A.firmarSesion(user.id), A.opcionesCookie());
  res.json({ user: A.publico(user) });
});

router.post('/logout', (req, res) => {
  res.clearCookie(A.COOKIE, { ...A.opcionesCookie(), maxAge: undefined });
  res.json({ ok: true });
});

router.get('/me', A.sesion, (req, res) => res.json({ user: A.publico(req.user) }));

// Para que la pantalla sepa si el enlace del mail todavía sirve antes de mostrar el formulario.
router.post('/check-token', async (req, res) => {
  const { token, type } = req.body || {};
  const tipo = type === 'invite' ? 'INVITE' : type === 'reset' ? 'RESET' : null;
  const t = tipo && (await A.buscarToken(token, tipo));
  if (!t) return res.status(400).json({ valid: false, error: 'El enlace no es válido o ya venció.' });
  res.json({ valid: true, email: t.user.email, name: t.user.name });
});

async function fijarContrasena(req, res, tipo) {
  const { token, password, name } = req.body || {};
  const t = await A.buscarToken(token, tipo);
  if (!t) return res.status(400).json({ error: 'El enlace no es válido o ya venció.' });
  const problema = A.problemaDeContrasena(password, t.user.email);
  if (problema) return res.status(400).json({ error: problema });
  const datos = { passwordHash: await A.hashPassword(password), passwordChangedAt: new Date() };
  if (tipo === 'INVITE' && texto(name, 100)) datos.name = name.trim();
  // Se marca el token como usado solo si nadie lo usó antes (dos pedidos a la vez: gana uno).
  const marcado = await prisma.token.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
  if (marcado.count !== 1) return res.status(400).json({ error: 'El enlace no es válido o ya venció.' });
  await prisma.user.update({ where: { id: t.userId }, data: datos });
  await prisma.token.deleteMany({ where: { userId: t.userId, usedAt: null } }); // cualquier otro enlace pendiente deja de valer
  res.json({ ok: true });
}

router.post('/accept-invite', (req, res) => fijarContrasena(req, res, 'INVITE'));
router.post('/reset', (req, res) => fijarContrasena(req, res, 'RESET'));

// Siempre la misma respuesta, exista o no el correo.
router.post('/forgot', async (req, res) => {
  const { email } = req.body || {};
  const respuesta = { ok: true, mensaje: 'Si el correo está registrado, te enviamos un enlace para restablecer la contraseña.' };
  if (!texto(email, 254)) return res.json(respuesta);
  const user = await prisma.user.findUnique({ where: { email: A.normalizarEmail(email) } });
  if (user && user.active && user.passwordChangedAt) {
    try {
      const token = await A.crearToken(user.id, 'RESET');
      await mail.enviar({
        para: user.email,
        asunto: 'Restablecer tu contraseña',
        titulo: 'Restablecer contraseña',
        parrafos: ['Pediste restablecer tu contraseña del Publicador de blogs.', 'El enlace sirve una sola vez y vence en 1 hora. Si no lo pediste vos, ignorá este mail.'],
        boton: 'Elegir una contraseña nueva',
        enlace: `${config.appUrl}/restablecer?token=${token}`,
      });
    } catch (e) {
      console.error('No se pudo enviar el mail de recuperación:', e.message);
    }
  }
  res.json(respuesta);
});

module.exports = router;
