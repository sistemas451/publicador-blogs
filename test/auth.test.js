// Pruebas de la Fase 2 contra la base real de Neon. Cada usuario de prueba lleva un correo
// @prueba.invalid y se borra al final (con sus tokens y registros de ingreso).
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const prisma = require('../src/lib/prisma');
const { createApp } = require('../src/app');
const A = require('../src/services/auth');
const mail = require('../src/services/mail');

const SUF = crypto.randomBytes(4).toString('hex');
const correo = (n) => `${n}-${SUF}@prueba.invalid`;
const CLAVE = 'una-clave-larga-123';
let server, base;

// Cliente mínimo que recuerda la cookie de sesión.
function cliente() {
  let cookie = '';
  const llamar = async (metodo, ruta, cuerpo, extra = {}) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const sc = r.headers.getSetCookie();
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    let json = null;
    try { json = await r.json(); } catch { /* sin cuerpo */ }
    return { status: r.status, json, headers: r.headers, setCookie: sc };
  };
  return { post: (r, b, h) => llamar('POST', r, b, h), get: (r) => llamar('GET', r), patch: (r, b) => llamar('PATCH', r, b), soltar: () => { cookie = ''; }, cookie: () => cookie };
}

async function crearUsuario(nombre, { admin = false, clave = CLAVE } = {}) {
  return prisma.user.create({
    data: { email: correo(nombre), name: nombre, isAdmin: admin, passwordHash: await A.hashPassword(clave), passwordChangedAt: new Date(Date.now() - 60000) },
  });
}
const tokenDelUltimoMail = () => new URL(mail.bandeja[mail.bandeja.length - 1].enlace).searchParams.get('token');

test.before(async () => {
  server = createApp({ limiteIntentos: 1000 }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await prisma.loginLog.deleteMany({ where: { email: { endsWith: `-${SUF}@prueba.invalid` } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${SUF}@prueba.invalid` } } });
  await prisma.$disconnect();
});

test('login: éxito, cookie httpOnly + SameSite=Strict, /me sin hash', async () => {
  await crearUsuario('ana');
  const c = cliente();
  const r = await c.post('/api/auth/login', { email: correo('ana').toUpperCase(), password: CLAVE });
  assert.strictEqual(r.status, 200);
  const sc = r.setCookie.join(';');
  assert.match(sc, /HttpOnly/i);
  assert.match(sc, /SameSite=Strict/i);
  const me = await c.get('/api/auth/me');
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.json.user.email, correo('ana'));
  assert.ok(!JSON.stringify(me.json).includes('passwordHash'));
});

test('login: usuario inexistente y clave mala dan el mismo mensaje; se registran', async () => {
  await crearUsuario('beto');
  const c = cliente();
  const a = await c.post('/api/auth/login', { email: correo('nadie'), password: CLAVE });
  const b = await c.post('/api/auth/login', { email: correo('beto'), password: 'otra-clave-equivocada' });
  assert.strictEqual(a.status, 401);
  assert.strictEqual(b.status, 401);
  assert.strictEqual(a.json.error, b.json.error);
  const fallos = await prisma.loginLog.count({ where: { email: { in: [correo('nadie'), correo('beto')] }, success: false } });
  assert.strictEqual(fallos, 2);
  await c.post('/api/auth/login', { email: correo('beto'), password: CLAVE });
  assert.strictEqual(await prisma.loginLog.count({ where: { email: correo('beto'), success: true } }), 1);
});

test('sin sesión: /me y las rutas de usuarios dan 401', async () => {
  const c = cliente();
  assert.strictEqual((await c.get('/api/auth/me')).status, 401);
  assert.strictEqual((await c.get('/api/users')).status, 401);
});

test('un usuario común no puede invitar (403)', async () => {
  await crearUsuario('comun');
  const c = cliente();
  await c.post('/api/auth/login', { email: correo('comun'), password: CLAVE });
  assert.strictEqual((await c.post('/api/users/invite', { email: correo('x'), name: 'X' })).status, 403);
});

test('invitación: el administrador invita, la persona elige clave y entra; el enlace sirve una sola vez', async () => {
  await crearUsuario('admin1', { admin: true });
  const adm = cliente();
  await adm.post('/api/auth/login', { email: correo('admin1'), password: CLAVE });
  const inv = await adm.post('/api/users/invite', { email: correo('nuevo'), name: 'Nuevo Usuario' });
  assert.strictEqual(inv.status, 201);
  assert.strictEqual(inv.json.user.pendiente, true);
  const token = tokenDelUltimoMail();

  // el token se guarda con hash, no en claro
  assert.strictEqual(await prisma.token.count({ where: { tokenHash: token } }), 0);

  const nuevo = cliente();
  // antes de aceptar no puede entrar
  assert.strictEqual((await nuevo.post('/api/auth/login', { email: correo('nuevo'), password: CLAVE })).status, 401);
  assert.strictEqual((await nuevo.post('/api/auth/check-token', { token, type: 'invite' })).json.valid, true);
  assert.strictEqual((await nuevo.post('/api/auth/accept-invite', { token, password: 'corta' })).status, 400); // contraseña débil
  assert.strictEqual((await nuevo.post('/api/auth/accept-invite', { token, password: CLAVE, name: 'Nuevo Nombre' })).status, 200);
  assert.strictEqual((await nuevo.post('/api/auth/login', { email: correo('nuevo'), password: CLAVE })).status, 200);
  assert.strictEqual((await nuevo.get('/api/auth/me')).json.user.name, 'Nuevo Nombre');
  // reutilizar el mismo enlace falla
  assert.strictEqual((await nuevo.post('/api/auth/accept-invite', { token, password: 'otra-clave-larga-1' })).status, 400);
  // invitar a quien ya tiene usuario: 409
  assert.strictEqual((await adm.post('/api/users/invite', { email: correo('nuevo'), name: 'Nuevo' })).status, 409);
});

test('invitación: correo inválido y reinvitar a un pendiente invalida el enlace anterior', async () => {
  await crearUsuario('admin2', { admin: true });
  const adm = cliente();
  await adm.post('/api/auth/login', { email: correo('admin2'), password: CLAVE });
  assert.strictEqual((await adm.post('/api/users/invite', { email: 'sistemas', name: 'X' })).status, 400);
  await adm.post('/api/users/invite', { email: correo('pend'), name: 'Pendiente' });
  const viejo = tokenDelUltimoMail();
  await adm.post('/api/users/invite', { email: correo('pend'), name: 'Pendiente' });
  const nuevo = tokenDelUltimoMail();
  assert.notStrictEqual(viejo, nuevo);
  const c = cliente();
  assert.strictEqual((await c.post('/api/auth/accept-invite', { token: viejo, password: CLAVE })).status, 400);
  assert.strictEqual((await c.post('/api/auth/accept-invite', { token: nuevo, password: CLAVE })).status, 200);
});

test('enlace vencido o inventado no sirve', async () => {
  const u = await crearUsuario('vence');
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.token.create({ data: { userId: u.id, type: 'RESET', tokenHash: crypto.createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() - 1000) } });
  const c = cliente();
  assert.strictEqual((await c.post('/api/auth/reset', { token, password: CLAVE })).status, 400);
  assert.strictEqual((await c.post('/api/auth/reset', { token: 'x'.repeat(64), password: CLAVE })).status, 400);
  assert.strictEqual((await c.post('/api/auth/reset', { token: 123, password: CLAVE })).status, 400);
});

test('desactivar a un usuario corta su sesión en el siguiente pedido', async () => {
  await crearUsuario('admin3', { admin: true });
  const u = await crearUsuario('baja');
  const adm = cliente();
  const c = cliente();
  await adm.post('/api/auth/login', { email: correo('admin3'), password: CLAVE });
  await c.post('/api/auth/login', { email: correo('baja'), password: CLAVE });
  assert.strictEqual((await c.get('/api/auth/me')).status, 200);
  assert.strictEqual((await adm.patch(`/api/users/${u.id}`, { active: false })).status, 200);
  assert.strictEqual((await c.get('/api/auth/me')).status, 401);
  assert.strictEqual((await c.post('/api/auth/login', { email: correo('baja'), password: CLAVE })).status, 401);
  // el administrador no puede desactivarse a sí mismo
  const yo = await prisma.user.findUnique({ where: { email: correo('admin3') } });
  assert.strictEqual((await adm.patch(`/api/users/${yo.id}`, { active: false })).status, 400);
});

test('recuperación: misma respuesta exista o no el correo; el reset cierra las sesiones viejas', async () => {
  await crearUsuario('olvido');
  const c = cliente();
  const antes = mail.bandeja.length;
  const a = await c.post('/api/auth/forgot', { email: correo('no-existe') });
  assert.strictEqual(mail.bandeja.length, antes, 'no debía mandar mail a un correo inexistente');
  const sesionVieja = cliente();
  await sesionVieja.post('/api/auth/login', { email: correo('olvido'), password: CLAVE });
  const b = await c.post('/api/auth/forgot', { email: correo('olvido') });
  assert.deepStrictEqual(a.json, b.json);
  assert.strictEqual(mail.bandeja.length, antes + 1);
  const token = tokenDelUltimoMail();
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual((await c.post('/api/auth/reset', { token, password: 'clave-nueva-larga-9' })).status, 200);
  assert.strictEqual((await c.post('/api/auth/reset', { token, password: 'clave-nueva-larga-9' })).status, 400); // un solo uso
  assert.strictEqual((await sesionVieja.get('/api/auth/me')).status, 401, 'la sesión anterior debía quedar invalidada');
  assert.strictEqual((await c.post('/api/auth/login', { email: correo('olvido'), password: CLAVE })).status, 401);
  assert.strictEqual((await c.post('/api/auth/login', { email: correo('olvido'), password: 'clave-nueva-larga-9' })).status, 200);
});

test('pedido que modifica datos desde otro origen: 403', async () => {
  const c = cliente();
  const r = await c.post('/api/auth/login', { email: correo('ana'), password: CLAVE }, { Origin: 'https://sitio-ajeno.example' });
  assert.strictEqual(r.status, 403);
});

test('la contraseña no puede ser igual al correo ni pasar los 72 caracteres', () => {
  assert.ok(A.problemaDeContrasena('a'.repeat(73), 'x@y.com'));
  assert.ok(A.problemaDeContrasena('persona@correo.com', 'persona@correo.com'));
  assert.strictEqual(A.problemaDeContrasena('una-clave-larga-123', 'x@y.com'), null);
});
