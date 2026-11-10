// Pruebas de la Fase 3. WordPress es SIMULADO (un servidor local que imita la API): no se toca el sitio real.
// La base de Neon sí es real; los usuarios @prueba.invalid se borran al final.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const prisma = require('../src/lib/prisma');
const { config } = require('../src/config');
const { createApp } = require('../src/app');
const A = require('../src/services/auth');
const wpCliente = require('../src/services/wordpress');
const { limpiar, tipoDeImagen } = require('../src/services/contenido');

const SUF = crypto.randomBytes(4).toString('hex');
const correo = (n) => `${n}-${SUF}@prueba.invalid`;
const CLAVE = 'una-clave-larga-123';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20)]);

// ---- WordPress simulado ----
let wpServer, app, base;
const wpSim = { media: new Map(), posts: [], tags: [], llamadas: [], falla: {}, sigId: 100 };
const esperado = 'Basic ' + Buffer.from('publicador:abcd efgh'.replace(/\s+/g, '')).toString('base64');
function reiniciarWp() { Object.assign(wpSim, { media: new Map(), posts: [], tags: [], llamadas: [], falla: {}, sigId: 100 }); wpCliente.limpiarCache(); }

function crearWpSimulado() {
  return http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const cuerpo = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const ruta = url.pathname.replace('/wp-json', '');
      wpSim.llamadas.push(`${req.method} ${ruta}`);
      const responder = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.headers.authorization !== esperado || wpSim.falla.auth) return responder(401, { code: 'rest_forbidden', message: 'no' });
      if (req.method === 'GET' && ruta === '/wp/v2/categories') return responder(200, [{ id: 1, name: 'Sin categoría', slug: 'uncategorized' }, { id: 7, name: 'Noticias &amp; Novedades', slug: 'noticias' }]);
      if (req.method === 'GET' && ruta === '/wp/v2/tags') return responder(200, wpSim.tags.filter((t) => t.slug === url.searchParams.get('slug')));
      if (req.method === 'POST' && ruta === '/wp/v2/tags') {
        if (wpSim.falla.tags) return responder(403, { code: 'rest_cannot_create', message: 'no' });
        const t = { id: 50, ...JSON.parse(cuerpo) }; wpSim.tags.push(t); return responder(201, t);
      }
      if (req.method === 'POST' && ruta === '/wp/v2/media') {
        const id = wpSim.sigId++;
        wpSim.media.set(id, { tipo: req.headers['content-type'], nombre: req.headers['content-disposition'], bytes: cuerpo.length });
        return responder(201, { id, source_url: `https://wp.example/uploads/img-${id}.png` });
      }
      if (req.method === 'DELETE' && ruta.startsWith('/wp/v2/media/')) { wpSim.media.delete(Number(ruta.split('/').pop())); return responder(200, { deleted: true }); }
      if (req.method === 'POST' && ruta === '/wp/v2/posts') {
        if (wpSim.falla.post) return responder(500, { code: 'x', message: 'boom' });
        const p = { id: wpSim.sigId++, ...JSON.parse(cuerpo) }; wpSim.posts.push(p);
        return responder(201, { id: p.id, link: `https://wp.example/?p=${p.id}`, status: p.status });
      }
      responder(404, { code: 'no', message: 'no' });
    });
  });
}

// ---- Cliente HTTP con cookie ----
function cliente() {
  let cookie = '';
  const llamar = async (metodo, ruta, cuerpo) => {
    const esForm = cuerpo instanceof FormData;
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(cuerpo && !esForm ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo === undefined ? undefined : esForm ? cuerpo : JSON.stringify(cuerpo),
    });
    const sc = r.headers.getSetCookie();
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    let json = null; try { json = await r.json(); } catch { /* sin cuerpo */ }
    return { status: r.status, json };
  };
  return { post: (r, b) => llamar('POST', r, b), get: (r) => llamar('GET', r) };
}
async function entrar(nombre, admin = false) {
  await prisma.user.create({ data: { email: correo(nombre), name: nombre, isAdmin: admin, passwordHash: await A.hashPassword(CLAVE), passwordChangedAt: new Date(Date.now() - 60000) } });
  const c = cliente();
  await c.post('/api/auth/login', { email: correo(nombre), password: CLAVE });
  return c;
}
function formulario({ title = 'Mi blog', categoryId = 7, author = 'Romina', html = '<p>Hola mundo</p>', featured, imagenes = [], extra = {} } = {}) {
  const f = new FormData();
  f.append('title', title); f.append('categoryId', String(categoryId)); f.append('author', author); f.append('html', html);
  if (featured !== undefined) f.append('featured', String(featured));
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  imagenes.forEach((b, i) => f.append('imagenes', new Blob([b]), `foto${i}.png`));
  return f;
}

test.before(async () => {
  wpServer = crearWpSimulado().listen(0);
  await new Promise((r) => wpServer.once('listening', r));
  Object.assign(config.wp, { url: `http://127.0.0.1:${wpServer.address().port}`, user: 'publicador', appPassword: 'abcd efgh', tagSlug: 'publicador' });
  app = createApp({ limiteIntentos: 1000 }).listen(0);
  await new Promise((r) => app.once('listening', r));
  base = `http://127.0.0.1:${app.address().port}`;
});
test.beforeEach(reiniciarWp);
test.after(async () => {
  app.close(); wpServer.close();
  await prisma.draft.deleteMany({ where: { user: { email: { endsWith: `-${SUF}@prueba.invalid` } } } });
  await prisma.loginLog.deleteMany({ where: { email: { endsWith: `-${SUF}@prueba.invalid` } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${SUF}@prueba.invalid` } } });
  await prisma.$disconnect();
});

// ---------- contenido ----------
test('limpiar: saca scripts, estilos, eventos y enlaces peligrosos; conserva el formato', () => {
  const sucio = '<h1>Título</h1><p style="color:red" onclick="x()">Hola <b>mundo</b> <a href="javascript:alert(1)">mal</a> <a href="https://ok.com/x">bien</a></p><script>alert(1)</script><iframe src="https://x"></iframe><style>p{}</style><img src="https://ajena.com/a.png"><img src=x onerror=alert(1)><img data-imagen="2" alt="foto">';
  const l = limpiar(sucio);
  assert.ok(!/script|iframe|style|onclick|onerror|javascript:|ajena/.test(l), l);
  assert.match(l, /<h2>Título<\/h2>/);
  assert.match(l, /<strong>mundo<\/strong>/);
  assert.match(l, /href="https:\/\/ok\.com\/x" target="_blank" rel="noopener noreferrer"/);
  assert.match(l, /<img data-imagen="2" alt="foto" \/>/);
  assert.strictEqual((l.match(/<img/g) || []).length, 1);
});

test('limpiar con urls: el marcador pasa a la dirección de WordPress', () => {
  const l = limpiar(limpiar('<p>a</p><img data-imagen="0" alt="x"><img data-imagen="3">'), { 0: 'https://wp.example/u/a.png' });
  assert.match(l, /<img src="https:\/\/wp\.example\/u\/a\.png" alt="x" \/>/);
  assert.ok(!/data-imagen/.test(l));
  assert.strictEqual((l.match(/<img/g) || []).length, 1); // la que no tenía dirección se descarta
});

test('tipoDeImagen mira el contenido, no el nombre', () => {
  assert.strictEqual(tipoDeImagen(PNG).mime, 'image/png');
  assert.strictEqual(tipoDeImagen(JPG).mime, 'image/jpeg');
  assert.strictEqual(tipoDeImagen(WEBP).mime, 'image/webp');
  assert.strictEqual(tipoDeImagen(Buffer.from('<?php echo 1; ?> aaaaaaaaaaaa')), null);
  assert.strictEqual(tipoDeImagen(Buffer.from('GIF89a aaaaaaaaaaaaaaaa')), null);
});

// ---------- ruta ----------
test('sin sesión: 401', async () => {
  const c = cliente();
  assert.strictEqual((await c.get('/api/categories')).status, 401);
  assert.strictEqual((await c.get('/api/drafts')).status, 401);
  assert.strictEqual((await c.post('/api/drafts', formulario())).status, 401);
});

test('categorías: sin "Sin categoría" y con los nombres decodificados', async () => {
  const c = await entrar('cat');
  const r = await c.get('/api/categories');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.categories, [{ id: 7, name: 'Noticias & Novedades' }]);
});

test('camino feliz: sube imágenes, arma el texto y crea UN borrador (draft) con categoría, destacada y etiqueta', async () => {
  const c = await entrar('feliz');
  const html = '<h1>Mi blog</h1><p>Texto <b>fuerte</b></p><img data-imagen="1" alt="segunda"><script>x()</script>';
  const r = await c.post('/api/drafts', formulario({ html, featured: 0, imagenes: [PNG, JPG, WEBP], extra: { status: 'publish' } }));
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.deepStrictEqual(r.json.advertencias, []);
  assert.match(r.json.draft.wpEditUrl, /\/wp-admin\/post\.php\?post=\d+&action=edit$/);

  assert.strictEqual(wpSim.posts.length, 1);
  const p = wpSim.posts[0];
  assert.strictEqual(p.status, 'draft', 'siempre borrador, aunque el cliente mande status=publish');
  assert.deepStrictEqual(p.categories, [7]);
  assert.deepStrictEqual(p.tags, [50]);
  assert.ok(p.content.startsWith('<p><em>Por Romina</em></p>'));
  assert.ok(!/script|data-imagen/.test(p.content));
  assert.match(p.content, /<img src="https:\/\/wp\.example\/uploads\/img-\d+\.png" alt="segunda" \/>/);
  // se subieron solo la usada (1) y la destacada (0); la 2 no se usó
  assert.strictEqual(wpSim.media.size, 2);
  assert.ok(p.featured_media >= 100);
  const nombres = [...wpSim.media.values()].map((m) => m.nombre).join(' ');
  assert.match(nombres, /blog-\d+-1\.png/);
  assert.match(nombres, /blog-\d+-2\.jpg/);

  const reg = await prisma.draft.findFirst({ where: { wpPostId: p.id } });
  assert.strictEqual(reg.status, 'CREADO');
  assert.strictEqual(reg.imageCount, 2);
  const lista = await c.get('/api/drafts');
  assert.strictEqual(lista.json.drafts.length, 1);
  assert.strictEqual(lista.json.drafts[0].title, 'Mi blog');
});

test('la etiqueta se reutiliza si ya existe; si no se puede crear, el borrador sale igual con una advertencia', async () => {
  const c = await entrar('etiqueta');
  wpSim.tags.push({ id: 9, slug: 'publicador' });
  assert.strictEqual((await c.post('/api/drafts', formulario())).status, 201);
  assert.deepStrictEqual(wpSim.posts[0].tags, [9]);
  assert.ok(!wpSim.llamadas.includes('POST /wp/v2/tags'));

  reiniciarWp(); wpSim.falla.tags = true;
  const r = await c.post('/api/drafts', formulario());
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.advertencias.length, 1);
  assert.strictEqual(wpSim.posts[0].tags, undefined);
});

test('validaciones: título, categoría, vacío, imagen falsa, imagen faltante, tamaño, cantidad', async () => {
  const c = await entrar('valida');
  const pedir = (o) => c.post('/api/drafts', formulario(o));
  assert.strictEqual((await pedir({ title: '  ' })).status, 400);
  assert.strictEqual((await pedir({ title: 'x'.repeat(201) })).status, 400);
  assert.strictEqual((await pedir({ categoryId: 999 })).status, 400);
  assert.strictEqual((await pedir({ categoryId: 'abc' })).status, 400);
  assert.strictEqual((await pedir({ html: '<p> &nbsp; </p><script>x</script>' })).status, 400);
  const falsa = await pedir({ imagenes: [Buffer.from('<?php system($_GET[0]); ?> aaaaaaaaaaaaaaaa')] });
  assert.strictEqual(falsa.status, 400);
  assert.match(falsa.json.error, /no es un JPG, PNG o WebP/);
  assert.strictEqual((await pedir({ html: '<p>a</p><img data-imagen="3">', imagenes: [PNG] })).status, 400);
  assert.strictEqual((await pedir({ featured: 4, imagenes: [PNG] })).status, 400);
  const grande = await pedir({ imagenes: [Buffer.concat([PNG, Buffer.alloc(config.maxImageMb * 1024 * 1024)])] });
  assert.strictEqual(grande.status, 400);
  assert.match(grande.json.error, /MB/);
  const muchas = await pedir({ imagenes: Array(config.maxImages + 1).fill(PNG) });
  assert.strictEqual(muchas.status, 400);
  assert.strictEqual(wpSim.posts.length, 0, 'ninguna validación fallida debía llegar a crear algo');
  assert.strictEqual(wpSim.media.size, 0);
});

test('si falla la creación del borrador, se borran las imágenes ya subidas y queda registrado el fallo', async () => {
  const c = await entrar('falla');
  wpSim.falla.post = true;
  const r = await c.post('/api/drafts', formulario({ html: '<p>a</p><img data-imagen="0">', imagenes: [PNG] }));
  assert.strictEqual(r.status, 502);
  assert.ok(!/boom/.test(JSON.stringify(r.json)), 'no debe filtrar el detalle de WordPress');
  assert.strictEqual(wpSim.media.size, 0, 'la imagen subida debía borrarse');
  assert.ok(wpSim.llamadas.includes('DELETE /wp/v2/media/100'));
  const fallido = await prisma.draft.findFirst({ where: { user: { email: correo('falla') }, status: 'FALLIDO' } });
  assert.ok(fallido);
});

test('si WordPress rechaza las credenciales: 502 con un mensaje claro para la persona', async () => {
  const c = await entrar('revocada');
  wpSim.falla.auth = true;
  const r = await c.post('/api/drafts', formulario());
  assert.strictEqual(r.status, 502);
  assert.match(r.json.error, /credenciales|contraseña de aplicación/);
});

test('doble clic: la segunda publicación simultánea recibe 409 y se crea un solo borrador', async () => {
  const c = await entrar('doble');
  const a = c.post('/api/drafts', formulario({ imagenes: [PNG], html: '<p>a</p><img data-imagen="0">' }));
  const b = c.post('/api/drafts', formulario({ imagenes: [PNG], html: '<p>a</p><img data-imagen="0">' }));
  const [ra, rb] = await Promise.all([a, b]);
  assert.deepStrictEqual([ra.status, rb.status].sort(), [201, 409]);
  assert.strictEqual(wpSim.posts.length, 1);
});

test('cada persona ve sus borradores; el administrador ve todos', async () => {
  const x = await entrar('listax');
  const y = await entrar('listay');
  const adm = await entrar('listaadm', true);
  await x.post('/api/drafts', formulario({ title: 'De X' }));
  await y.post('/api/drafts', formulario({ title: 'De Y' }));
  assert.deepStrictEqual((await x.get('/api/drafts')).json.drafts.map((d) => d.title), ['De X']);
  const todos = (await adm.get('/api/drafts')).json.drafts.map((d) => d.title);
  assert.ok(todos.includes('De X') && todos.includes('De Y'));
});

test('el autor se escapa en la línea "Por ..." y sin autor no se agrega la línea', async () => {
  const c = await entrar('autor');
  await c.post('/api/drafts', formulario({ author: '<b>Ro</b> & "Co"' }));
  assert.ok(wpSim.posts[0].content.startsWith('<p><em>Por &lt;b&gt;Ro&lt;/b&gt; &amp; &quot;Co&quot;</em></p>'));
  reiniciarWp();
  await c.post('/api/drafts', formulario({ author: '' }));
  assert.ok(wpSim.posts[0].content.startsWith('<p>Hola mundo</p>'));
});
