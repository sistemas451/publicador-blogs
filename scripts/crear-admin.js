// Crea al primer administrador y le manda (o imprime) un enlace de un solo uso para elegir su contraseña.
// Uso:  node scripts/crear-admin.js correo@dominio.com "Nombre Apellido"
// No imprime ni guarda ninguna contraseña. El enlace vence a las 48 horas.
const crypto = require('crypto');
const prisma = require('../src/lib/prisma');
const { config } = require('../src/config');
const A = require('../src/services/auth');
const mail = require('../src/services/mail');

(async () => {
  const correo = A.normalizarEmail(process.argv[2]);
  const nombre = (process.argv[3] || '').trim();
  if (!A.emailValido(correo) || !nombre) {
    console.error('Uso: node scripts/crear-admin.js correo@dominio.com "Nombre Apellido"');
    process.exit(1);
  }
  let user = await prisma.user.findUnique({ where: { email: correo } });
  if (user && user.passwordChangedAt) {
    console.error('Ese correo ya tiene un usuario con contraseña. No se hizo nada.');
    process.exit(1);
  }
  const sinClave = await A.hashPassword(crypto.randomBytes(32).toString('hex'));
  user = user
    ? await prisma.user.update({ where: { id: user.id }, data: { name: nombre, isAdmin: true, active: true } })
    : await prisma.user.create({ data: { email: correo, name: nombre, isAdmin: true, passwordHash: sinClave } });
  const token = await A.crearToken(user.id, 'INVITE');
  const enlace = `${config.appUrl}/aceptar-invitacion?token=${token}`;
  try {
    await mail.enviar({
      para: user.email,
      asunto: 'Acceso de administrador al Publicador de blogs',
      titulo: `Hola ${user.name}`,
      parrafos: ['Te crearon como administrador del Publicador de blogs de Myselec.', 'Elegí tu contraseña con el botón de abajo. El enlace sirve una sola vez y vence en 48 horas.'],
      boton: 'Elegir mi contraseña',
      enlace,
    });
    console.log(`Administrador listo: ${user.email}. ${mail.modoReal() ? 'Se envió el mail con el enlace.' : 'Mail simulado (sin Resend configurado); usá este enlace:'}`);
    if (!mail.modoReal()) console.log(enlace);
  } catch (e) {
    console.log(`Administrador creado: ${user.email}, pero no se pudo enviar el mail (${e.message}). Enlace de un solo uso:`);
    console.log(enlace);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
