// "Traer desde LinkedIn" con un LinkedIn SIMULADO (una función fetch falsa): no sale a internet.
const test = require('node:test');
const assert = require('node:assert');
const { config } = require('../src/config');
const { traer, ErrorLinkedin, textoAHtml, tituloDe } = require('../src/services/linkedin');

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)]);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const ld = (o) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'http://schema.org', '@type': 'SocialMediaPosting', ...o })}</script>`;
const TEXTO = 'Una vez más, recorrimos rutas. Fue lindo!\n\nEsta vez, Tucumán & <Santiago>.\nSegundo renglón.\n\nRutas argentinas, hasta el fin!';

// Mapa url → respuesta. Una respuesta es { status, body, headers } o una función.
function fetchFalso(mapa) {
  const pedidos = [];
  const fn = async (url, opciones) => {
    pedidos.push({ url, opciones });
    const r = mapa[url];
    // Respuesta a mano (Response no admite el estado 999, que es el que usa LinkedIn para rechazar).
    const x = r ? (typeof r === 'function' ? r() : r) : { status: 404, body: 'no' };
    const status = x.status || 200;
    const h = Object.fromEntries(Object.entries(x.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = Buffer.isBuffer(x.body) ? x.body : Buffer.from(String(x.body ?? ''));
    return { status, ok: status >= 200 && status < 300, headers: { get: (k) => h[k.toLowerCase()] ?? null }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) };
  };
  fn.pedidos = pedidos;
  return fn;
}

test('posteo con foto: texto completo en párrafos, título, autor e imagen; sigue la redirección de lnkd.in', async () => {
  const f = fetchFalso({
    'https://lnkd.in/p/abc': { status: 301, headers: { location: 'https://www.linkedin.com/posts/nico_123' } },
    'https://www.linkedin.com/posts/nico_123': { body: `<html>${ld({ articleBody: TEXTO, author: { name: 'Nicolas Javier Garcia Naino' }, datePublished: '2026-11-05', image: { url: 'https://media.licdn.com/foto1.jpg' } })}</html>` },
    'https://media.licdn.com/foto1.jpg': { body: JPG },
  });
  const r = await traer('https://lnkd.in/p/abc', { fetchFn: f });
  assert.strictEqual(r.tipo, 'foto');
  assert.strictEqual(r.autor, 'Nicolas Javier Garcia Naino');
  assert.strictEqual(r.titulo, 'Una vez más, recorrimos rutas.');
  assert.strictEqual(r.html, '<p>Una vez más, recorrimos rutas. Fue lindo!</p><p>Esta vez, Tucumán &amp; &lt;Santiago&gt;.<br>Segundo renglón.</p><p>Rutas argentinas, hasta el fin!</p>');
  assert.strictEqual(r.imagenes.length, 1);
  assert.strictEqual(r.imagenes[0].mime, 'image/jpeg');
  assert.ok(Buffer.from(r.imagenes[0].datos, 'base64').equals(JPG));
  // Se identifica y no sigue redirecciones solo
  assert.ok(f.pedidos.every((p) => p.opciones.redirect === 'manual' && /publicador-blogs/.test(p.opciones.headers['User-Agent'])));
});

test('posteo con documento: trae todas las páginas del visor público, en la resolución más cercana a 1290', async () => {
  const pagina = `<html>${ld({ articleBody: 'Texto del documento', author: { name: 'X' } })}<iframe data="{&quot;coverPages&quot;:[{&quot;config&quot;:{&quot;src&quot;:&quot;https://media.licdn.com/tapa.jpg&quot;}}],&quot;manifestUrl&quot;:&quot;https://media.licdn.com/manifest&quot;}"></iframe></html>`;
  const f = fetchFalso({
    'https://www.linkedin.com/posts/doc': { body: pagina },
    'https://media.licdn.com/manifest': { body: JSON.stringify({ perResolutions: [{ width: 1920, imageManifestUrl: 'https://media.licdn.com/m1920' }, { width: 1290, imageManifestUrl: 'https://media.licdn.com/m1290' }, { width: 480, imageManifestUrl: 'https://media.licdn.com/m480' }] }) },
    'https://media.licdn.com/m1290': { body: JSON.stringify({ pages: ['https://media.licdn.com/p1.jpg', 'https://media.licdn.com/p2.png', 'https://media.licdn.com/p3.jpg'] }) },
    'https://media.licdn.com/p1.jpg': { body: JPG }, 'https://media.licdn.com/p2.png': { body: PNG }, 'https://media.licdn.com/p3.jpg': { body: JPG },
  });
  const r = await traer('https://www.linkedin.com/posts/doc', { fetchFn: f });
  assert.strictEqual(r.tipo, 'documento');
  assert.deepStrictEqual(r.imagenes.map((i) => i.nombre), ['linkedin-1.jpg', 'linkedin-2.png', 'linkedin-3.jpg']);
  assert.ok(!f.pedidos.some((p) => p.url.includes('m1920') || p.url.includes('m480')));
});

test('documento sin visor completo: se queda con las páginas de la tapa y avisa', async () => {
  const pagina = `${ld({ articleBody: 'Texto' })}<i data="&quot;coverPages&quot;:[{&quot;config&quot;:{&quot;src&quot;:&quot;https://media.licdn.com/t1.jpg&quot;}}],&quot;manifestUrl&quot;:&quot;https://media.licdn.com/roto&quot;"></i>`;
  const f = fetchFalso({ 'https://www.linkedin.com/posts/d2': { body: pagina }, 'https://media.licdn.com/roto': { status: 500 }, 'https://media.licdn.com/t1.jpg': { body: JPG } });
  const r = await traer('https://www.linkedin.com/posts/d2', { fetchFn: f });
  assert.strictEqual(r.imagenes.length, 1);
  assert.ok(r.advertencias.some((a) => /primeras páginas/.test(a)));
});

test('rechaza links que no son de LinkedIn y redirecciones o imágenes fuera de LinkedIn', async () => {
  for (const u of ['http://www.linkedin.com/posts/x', 'https://evil.com/posts', 'https://linkedin.com.evil.com/x', 'javascript:alert(1)', '', 'https://127.0.0.1/']) {
    await assert.rejects(traer(u, { fetchFn: fetchFalso({}) }), (e) => e instanceof ErrorLinkedin && e.status === 400, u);
  }
  const f = fetchFalso({ 'https://lnkd.in/p/x': { status: 302, headers: { location: 'http://169.254.169.254/latest' } } });
  await assert.rejects(traer('https://lnkd.in/p/x', { fetchFn: f }), /no es de LinkedIn/);
  assert.strictEqual(f.pedidos.length, 1);
  // una imagen que apunta a otro sitio no se pide
  const g = fetchFalso({ 'https://www.linkedin.com/posts/y': { body: ld({ articleBody: 'Hola', image: 'https://otro.com/x.jpg' }) } });
  const r = await traer('https://www.linkedin.com/posts/y', { fetchFn: g });
  assert.strictEqual(r.imagenes.length, 0);
  assert.ok(!g.pedidos.some((p) => p.url.includes('otro.com')));
});

test('posteo no público o sin datos, LinkedIn caído, demasiado grande, imagen que no es imagen', async () => {
  await assert.rejects(traer('https://www.linkedin.com/posts/z', { fetchFn: fetchFalso({ 'https://www.linkedin.com/posts/z': { body: '<html>authwall</html>' } }) }), /no muestra el texto/);
  await assert.rejects(traer('https://www.linkedin.com/posts/z', { fetchFn: fetchFalso({ 'https://www.linkedin.com/posts/z': { status: 999 } }) }), /no devolvió el posteo \(999\)/);
  await assert.rejects(traer('https://www.linkedin.com/posts/z', { fetchFn: fetchFalso({ 'https://www.linkedin.com/posts/z': { body: 'x', headers: { 'content-length': String(10 * 1024 * 1024) } } }) }), /demasiado grande/);
  const f = fetchFalso({ 'https://www.linkedin.com/posts/w': { body: ld({ text: 'Hola', image: ['https://media.licdn.com/a.jpg', 'https://media.licdn.com/b.jpg'] }) }, 'https://media.licdn.com/a.jpg': { body: '<html>no</html>' }, 'https://media.licdn.com/b.jpg': { body: JPG } });
  const r = await traer('https://www.linkedin.com/posts/w', { fetchFn: f });
  assert.strictEqual(r.imagenes.length, 1);
  assert.ok(r.advertencias.some((a) => /imagen 1/.test(a)));
});

test('más imágenes que el límite: trae las primeras y avisa; posteo solo texto avisa que no hay imágenes', async () => {
  const urls = Array.from({ length: config.maxImages + 3 }, (_, i) => `https://media.licdn.com/i${i}.jpg`);
  const mapa = { 'https://www.linkedin.com/posts/m': { body: ld({ text: 'Hola', image: urls }) } };
  urls.forEach((u) => { mapa[u] = { body: JPG }; });
  const r = await traer('https://www.linkedin.com/posts/m', { fetchFn: fetchFalso(mapa) });
  assert.strictEqual(r.imagenes.length, config.maxImages);
  assert.ok(r.advertencias.some((a) => /primeras/.test(a)));
  const t = await traer('https://www.linkedin.com/posts/t', { fetchFn: fetchFalso({ 'https://www.linkedin.com/posts/t': { body: ld({ text: 'Solo texto' }) } }) });
  assert.strictEqual(t.tipo, 'texto');
  assert.ok(t.advertencias.some((a) => /no tiene imágenes/.test(a)));
});

test('título: primera oración, cortado prolijo si es muy largo', () => {
  assert.strictEqual(tituloDe('¿Qué hacemos? Mucho.'), '¿Qué hacemos?');
  assert.strictEqual(tituloDe('Primera línea sin punto\nsegunda'), 'Primera línea sin punto');
  assert.strictEqual(tituloDe('Viajamos con Eduardo U. García al norte. Fue genial.'), 'Viajamos con Eduardo U. García al norte.');
  assert.strictEqual(tituloDe('Vendemos 3.5 kV y más. Otra.'), 'Vendemos 3.5 kV y más.');
  const largo = tituloDe('palabra '.repeat(40));
  assert.ok(largo.length <= 120 && largo.endsWith('…'));
  assert.strictEqual(textoAHtml('a\r\n\r\nb'), '<p>a</p><p>b</p>');
});
