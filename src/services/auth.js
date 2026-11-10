const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { config } = require('../config');

const COOKIE = 'sesion';
const DURACION_SESION_MS = 7 * 24 * 60 * 60 * 1000;
const VIGENCIA = { INVITE: 48 * 60 * 60 * 1000, RESET: 60 * 60 * 1000 };

const normalizarEmail = (e) => String(e || '').trim().toLowerCase();
const emailValido = (e) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

// Contraseña: 10 a 72 caracteres (bcrypt solo lee los primeros 72 bytes) y distinta del correo.
function problemaDeContrasena(pass, email) {
  if (typeof pass !== 'string' || pass.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (Buffer.byteLength(pass) > 72) return 'La contraseña es demasiado larga (máximo 72 caracteres).';
  if (email && pass.toLowerCase() === email.toLowerCase()) return 'La contraseña no puede ser igual al correo.';
  return null;
}

const hashPassword = (pass) => bcrypt.hash(pass, 12);
const HASH_FALSO = bcrypt.hashSync('contrasena-que-nadie-usa', 12); // "no existe" tarda igual que "clave mal"
const verificar = (pass, hash) => bcrypt.compare(pass, hash || HASH_FALSO);

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Crea un token de un solo uso. Solo se guarda su hash; el valor en claro se devuelve una vez.
async function crearToken(userId, type) {
  await prisma.token.deleteMany({ where: { userId, type, usedAt: null } }); // el anterior sin usar deja de valer
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.token.create({ data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + VIGENCIA[type]) } });
  return token;
}

// Devuelve el registro del token si existe, es del tipo pedido, no venció y no se usó.
async function buscarToken(token, type) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const t = await prisma.token.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!t || t.type !== type || t.usedAt || t.expiresAt < new Date()) return null;
  return t;
}

const firmarSesion = (userId) => jwt.sign({ sub: userId, emitido: Date.now() }, config.jwtSecret, { expiresIn: '7d' });

const opcionesCookie = () => ({ httpOnly: true, sameSite: 'strict', secure: config.isProd, path: '/', maxAge: DURACION_SESION_MS });

// En cada pedido se vuelve a leer el usuario de la base: si se desactivó o cambió la contraseña, la sesión deja de valer.
async function requiereSesion(req, res) {
  const tk = req.cookies && req.cookies[COOKIE];
  if (!tk) return res.status(401).json({ error: 'Tenés que iniciar sesión.' });
  let p;
  try { p = jwt.verify(tk, config.jwtSecret); } catch { return res.status(401).json({ error: 'La sesión venció. Iniciá sesión de nuevo.' }); }
  const user = await prisma.user.findUnique({ where: { id: p.sub } });
  if (!user || !user.active) return res.status(401).json({ error: 'La sesión ya no es válida.' });
  if (user.passwordChangedAt && p.emitido < user.passwordChangedAt.getTime()) return res.status(401).json({ error: 'La contraseña cambió. Iniciá sesión de nuevo.' });
  req.user = user;
  return null;
}

// Para usar como middleware: corta si no hay sesión válida.
const sesion = async (req, res, next) => { if (!(await requiereSesion(req, res))) next(); };

const admin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'No tenés permiso para esto.' });
  next();
};

const publico = (u) => ({ id: u.id, email: u.email, name: u.name, isAdmin: u.isAdmin, active: u.active });

module.exports = {
  COOKIE, normalizarEmail, emailValido, problemaDeContrasena, hashPassword, verificar,
  crearToken, buscarToken, firmarSesion, opcionesCookie, sesion, admin, publico,
};
