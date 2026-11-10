// WordPress FALSO para probar las pantallas sin tocar el sitio real. Solo desarrollo.
// Uso (dos terminales):
//   node scripts/wp-falso.js
//   WP_URL=http://127.0.0.1:4000 WP_USER=publicador WP_APP_PASSWORD="abcd efgh" npm run dev
// (las variables del entorno tienen prioridad sobre el .env). Guarda en memoria lo que recibe y lo muestra en la consola.
const http = require('http');
const esperado = 'Basic ' + Buffer.from('publicador:abcdefgh').toString('base64');
let id = 100;
http.createServer((req, res) => {
  const partes = [];
  req.on('data', (c) => partes.push(c));
  req.on('end', () => {
    const cuerpo = Buffer.concat(partes);
    const ruta = new URL(req.url, 'http://x').pathname.replace('/wp-json', '');
    const ok = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    console.log(req.method, ruta, cuerpo.length ? `(${cuerpo.length} bytes)` : '');
    if (req.headers.authorization !== esperado) return ok(401, { code: 'rest_forbidden', message: 'no' });
    if (req.method === 'GET' && ruta === '/wp/v2/categories') return ok(200, [{ id: 3, name: 'Noticias', slug: 'noticias' }, { id: 4, name: 'Guías &amp; consejos', slug: 'guias' }]);
    if (req.method === 'GET' && ruta === '/wp/v2/tags') return ok(200, []);
    if (req.method === 'POST' && ruta === '/wp/v2/tags') return ok(201, { id: 50 });
    if (req.method === 'POST' && ruta === '/wp/v2/media') return ok(201, { id: id++, source_url: 'https://wp.falso/uploads/img.png' });
    if (req.method === 'DELETE') return ok(200, { deleted: true });
    if (req.method === 'POST' && ruta === '/wp/v2/posts') {
      const p = JSON.parse(cuerpo);
      console.log('\n=== BORRADOR RECIBIDO ===\nestado:', p.status, '| categorías:', p.categories, '| destacada:', p.featured_media, '| etiquetas:', p.tags, '\ntítulo:', p.title, '\n', p.content, '\n=========================\n');
      return ok(201, { id: id++, link: 'https://wp.falso/?p=1', status: p.status });
    }
    ok(404, { code: 'no', message: 'no' });
  });
}).listen(4000, '127.0.0.1', () => console.log('WordPress falso en http://127.0.0.1:4000'));
