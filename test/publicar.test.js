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
let wpServer, app, base, autorBase;
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
      if (req.method === 'GET' && ruta === '/wp/v2/posts') {
        if (wpSim.falla.estados) return responder(500, { code: 'x', message: 'caido' });
        const ids = (url.searchParams.get('include') || '').split(',').map(Number);
        return responder(200, wpSim.posts.filter((p) => ids.includes(p.id) && !p.borrado).map((p) => ({ id: p.id, status: p.status, link: `https://wp.example/blog-${p.id}/` })));
      }
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
  return { post: (r, b) => llamar('POST', r, b), get: (r) => llamar('GET', r), patch: (r, b) => llamar('PATCH', r, b) };
}
async function entrar(nombre, admin = false) {
  await prisma.user.create({ data: { email: correo(nombre), name: nombre, isAdmin: admin, passwordHash: await A.hashPassword(CLAVE), passwordChangedAt: new Date(Date.now() - 60000) } });
  const c = cliente();
  await c.post('/api/auth/login', { email: correo(nombre), password: CLAVE });
  return c;
}
function formulario({ title = 'Mi blog', categoryId = 7, html = '<p>Hola mundo</p>', authorId = autorBase.id, featured, imagenes = [], extra = {} } = {}) {
  const f = new FormData();
  f.append('title', title); f.append('categoryId', String(categoryId)); f.append('authorId', authorId); f.append('html', html);
  if (featured !== undefined) f.append('featured', String(featured));
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  imagenes.forEach((b, i) => f.append('imagenes', new Blob([b]), `foto${i}.png`));
  return f;
}

test.before(async () => {
  autorBase = await prisma.author.create({ data: { name: `Romina ${SUF}`, role: 'Marketing' } });
  wpServer = crearWpSimulado().listen(0);
  await new Promise((r) => wpServer.once('listening', r));
  Object.assign(config.wp, { url: `http://127.0.0.1:${wpServer.address().port}`, user: 'publicador', appPassword: 'abcd efgh', tagSlug: 'publicador' });
  app = createApp({ limiteIntentos: 1000 }).listen(0);
  await new Promise((r) => app.once('listening', r));
  base = `http://127.0.0.1:${app.address().port}`;
});
test.beforeEach(reiniciarWp);
test.after(async () => {
  await prisma.author.deleteMany({ where: { name: { endsWith: ` ${SUF}` } } });
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
  assert.ok(!/<a [^>]*>mal<\/a>/.test(l) && l.includes('mal'), 'el enlace javascript: deja solo el texto');
  assert.match(l, /<h2>Título<\/h2>/);
  assert.match(l, /<strong>mundo<\/strong>/);
  assert.match(l, /href="https:\/\/ok\.com\/x" target="_blank" rel="noopener noreferrer"/);
  assert.match(l, /<img data-imagen="2" alt="foto" \/>/);
  assert.strictEqual((l.match(/<img/g) || []).length, 1);
});

test('limpiar: texto plano pegado (cada línea es un <div>) queda en párrafos; las líneas en blanco no dejan párrafos vacíos', () => {
  const l = limpiar('Primero.<div><br></div><div>Segundo 😅.</div><div><br></div><div>Tercero.</div>');
  assert.strictEqual(l, 'Primero.<p>Segundo 😅.</p><p>Tercero.</p>');
  assert.strictEqual(limpiar('<p>a</p><p><br></p><p> &nbsp; </p><p><img data-imagen="0" alt="x"></p>'), '<p>a</p><p><img data-imagen="0" alt="x" /></p>');
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

test('vista previa: devuelve el mismo HTML limpio que se publicaría; pide sesión', async () => {
  assert.strictEqual((await cliente().post('/api/preview', { html: '<p>x</p>' })).status, 401);
  const c = await entrar('previa');
  const r = await c.post('/api/preview', { html: '<h1>T</h1><script>x()</script><p onclick="y()">a</p><img data-imagen="0" src="https://ajena.com/x.png">' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.html, limpiar('<h1>T</h1><script>x()</script><p onclick="y()">a</p><img data-imagen="0" src="https://ajena.com/x.png">'));
  assert.ok(!/script|onclick|ajena/.test(r.json.html));
  assert.strictEqual((await c.post('/api/preview', { html: 5 })).status, 400);
});

test('categorías: sin "Sin categoría" y con los nombres decodificados', async () => {
  const c = await entrar('cat');
  const r = await c.get('/api/categories');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.categories, [{ id: 7, name: 'Noticias & Novedades' }]);
  assert.deepStrictEqual(r.json.limits, { maxImages: config.maxImages, maxImageMb: config.maxImageMb });
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
  assert.ok(p.content.startsWith('<div class="publicador-autor"') && p.content.includes(`Romina ${SUF}</strong><span style="display:block;font-size:16px;line-height:24px;font-weight:400;color:#7a7a7a">Marketing</span>`));
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

test('autores: la línea sale escapada con cargo y enlace; el autor es obligatorio y tiene que estar activo', async () => {
  const c = await entrar('autor');
  const a = await prisma.author.create({ data: { name: `<b>Ro</b> & "Co" ${SUF}`, role: 'Jefa <i>', linkUrl: 'https://linkedin.com/in/x' } });
  await c.post('/api/drafts', formulario({ authorId: a.id }));
  const linea = wpSim.posts[0].content.split('\n')[0];
  assert.ok(linea.startsWith('<div class="publicador-autor"') && !linea.includes('<img'), linea);
  assert.ok(linea.includes('&lt;b&gt;Ro&lt;/b&gt; &amp; &quot;Co&quot;') && linea.includes('href="https://linkedin.com/in/x"'), linea);
  assert.ok(linea.includes('Jefa &lt;i&gt; – <a'), linea);
  reiniciarWp();
  assert.strictEqual((await c.post('/api/drafts', formulario({ authorId: '' }))).status, 400);
  assert.strictEqual((await c.post('/api/drafts', formulario({ authorId: 'no-existe' }))).status, 400);
  await prisma.author.update({ where: { id: a.id }, data: { active: false } });
  assert.strictEqual((await c.post('/api/drafts', formulario({ authorId: a.id }))).status, 400);
  assert.strictEqual(wpSim.posts.length, 0);
  // sin cargo ni enlace: solo el nombre; un enlace que no es http no se usa
  const b = await prisma.author.create({ data: { name: `Simple ${SUF}`, linkUrl: 'javascript:alert(1)' } });
  await c.post('/api/drafts', formulario({ authorId: b.id }));
  assert.ok(wpSim.posts[0].content.includes(`>Simple ${SUF}</strong></div></div>`) && !wpSim.posts[0].content.includes('javascript:'));
});

test('autores: todos los usuarios ven los activos; solo el admin agrega, edita y desactiva', async () => {
  const adm = await entrar('adm-aut', true);
  const u = await entrar('usr-aut');
  assert.strictEqual((await u.post('/api/authors', { name: `X ${SUF}` })).status, 403);
  assert.strictEqual((await adm.post('/api/authors', { name: '' })).status, 400);
  assert.strictEqual((await adm.post('/api/authors', { name: `X ${SUF}`, linkUrl: 'ftp://x' })).status, 400);
  const r = await adm.post('/api/authors', { name: `Nuevo ${SUF}`, role: ' Gerente ', linkUrl: '' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.author.role, 'Gerente');
  const id = r.json.author.id;
  assert.ok((await u.get('/api/authors')).json.authors.some((a) => a.id === id));
  assert.strictEqual((await u.patch(`/api/authors/${id}`, { active: false })).status, 403);
  assert.strictEqual((await adm.patch(`/api/authors/${id}`, { name: `Renombrado ${SUF}` })).json.author.role, 'Gerente');
  await adm.patch(`/api/authors/${id}`, { active: false });
  assert.ok(!(await u.get('/api/authors')).json.authors.some((a) => a.id === id));
  assert.ok(!(await u.get('/api/authors?todos=1')).json.authors.some((a) => a.id === id));
  assert.ok((await adm.get('/api/authors?todos=1')).json.authors.some((a) => a.id === id));
  assert.strictEqual((await adm.patch('/api/authors/no-existe', { active: true })).status, 404);
});

test('autores con foto: se sube a WordPress, el bloque sale con la foto y al cambiarla se borra la anterior', async () => {
  const adm = await entrar('adm-foto', true);
  
  const mala = new FormData(); mala.append('name', `Mala ${SUF}`); mala.append('foto', new Blob([Buffer.from('GIF89a-no-sirve-xxxxxxxx')]), 'f.gif');
  assert.strictEqual((await adm.post('/api/authors', mala)).status, 400);
  assert.strictEqual(wpSim.media.size, 0);
  const f1 = new FormData(); f1.append('name', `Fotos ${SUF}`); f1.append('role', 'Ing.'); f1.append('linkUrl', 'https://linkedin.com/in/y'); f1.append('foto', new Blob([PNG]), 'a.png');
  const r = await adm.post('/api/authors', f1);
  assert.strictEqual(r.status, 201);
  assert.ok(r.json.author.photoUrl.startsWith('http'));
  assert.strictEqual(wpSim.media.size, 1);
  await adm.post('/api/drafts', formulario({ authorId: r.json.author.id }));
  const c = wpSim.posts[0].content;
  assert.ok(c.startsWith('<div class="publicador-autor"') && c.includes('width:96px'), c);
  assert.ok(c.includes(`src="${r.json.author.photoUrl}"`) && c.includes('[Linkedin]') && c.includes('>Ing.'), c);
  const f2 = new FormData(); f2.append('foto', new Blob([JPG]), 'b.jpg');
  assert.strictEqual((await adm.patch(`/api/authors/${r.json.author.id}`, f2)).status, 200);
  assert.strictEqual(wpSim.media.size, 1); // la anterior se borró
});

test('limpiar: un párrafo con saltos de línea se separa en párrafos; los renglones vacíos no quedan', () => {
  assert.strictEqual(limpiar('<p>Uno<br>Dos<br><br>Tres</p>'), '<p>Uno</p><p>Dos</p><p>Tres</p>');
  assert.strictEqual(limpiar('<p>Sin saltos</p>'), '<p>Sin saltos</p>');
});

test('carrusel: se conserva como bloque, se publica con la clase de la plantilla y sus imágenes se suben', async () => {
  assert.strictEqual(limpiar('<div data-carrusel="1"></div><div data-carrusel="1"><figure><img src="http://x/y.jpg"></figure></div>'), '');
  assert.strictEqual(limpiar('<div class="x">linea</div>'), '<p>linea</p>');
  const c = await entrar('carrusel');
  const html = '<p>Texto</p><div data-carrusel="1"><figure><img data-imagen="0" alt="uno"></figure><figure><img data-imagen="1" alt="dos"></figure></div>';
  const r = await c.post('/api/drafts', formulario({ html, imagenes: [PNG, JPG] }));
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  const cont = wpSim.posts[0].content;
  assert.match(cont, /<div class="publicador-carrusel"><figure><img src="[^"]+" alt="uno" \/><\/figure><figure><img src="[^"]+" alt="dos" \/><\/figure><\/div>/);
  assert.strictEqual(wpSim.media.size, 2);
});


test('Mis borradores muestra el estado actual en WordPress, y la lista sale igual si WordPress no responde', async () => {
  const c = await entrar('estados');
  for (const t of ['Uno', 'Dos', 'Tres']) await c.post('/api/drafts', formulario({ title: `Estado ${t} ${SUF}` }));
  const [p1, p2, p3] = wpSim.posts.slice(-3);
  p2.status = 'publish'; p3.borrado = true;
  let l = (await c.get('/api/drafts')).json.drafts.filter((d) => d.title.endsWith(SUF) && d.title.startsWith('Estado'));
  const por = Object.fromEntries(l.map((d) => [d.title.split(' ')[1], d]));
  assert.strictEqual(por.Uno.wpEstado, 'draft'); assert.strictEqual(por.Uno.wpLink, null);
  assert.strictEqual(por.Dos.wpEstado, 'publish'); assert.strictEqual(por.Dos.wpLink, `https://wp.example/blog-${p2.id}/`);
  assert.strictEqual(por.Tres.wpEstado, 'borrado');
  wpSim.falla.estados = true;
  l = (await c.get('/api/drafts')).json.drafts;
  assert.ok(l.length >= 3 && l.every((d) => d.wpEstado === null));
});
