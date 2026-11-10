// Fase 0 del publicador: prueba la API de WordPress con el usuario del publicador.
// Lee WP_URL, WP_USER y WP_APP_PASSWORD de un archivo .env en la carpeta desde donde se corre.
// Crea un borrador con una imagen de prueba y LOS BORRA al terminar. Nunca publica.
const fs = require('fs');
if (fs.existsSync('.env')) for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { WP_URL, WP_USER, WP_APP_PASSWORD } = process.env;
if (!WP_URL || !WP_USER || !WP_APP_PASSWORD) { console.error('Faltan WP_URL, WP_USER o WP_APP_PASSWORD en el .env'); process.exit(1); }
const auth = 'Basic ' + Buffer.from(`${WP_USER}:${WP_APP_PASSWORD.replace(/\s+/g, '')}`).toString('base64');
const api = (p, o = {}) => fetch(`${WP_URL.replace(/\/$/, '')}/wp-json${p}`, { ...o, headers: { Authorization: auth, ...(o.headers || {}) }, signal: AbortSignal.timeout(60000) });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const paso = (n, ok, d = '') => console.log(`${ok ? 'OK  ' : 'FALLA'} ${n}${d ? ' — ' + d : ''}`);
(async () => {
  let r = await api('/wp/v2/users/me?context=edit');
  if (r.status !== 200) { paso('Autenticación', false, `HTTP ${r.status} (${(await r.text()).slice(0, 160)})`); process.exit(2); }
  const me = await r.json();
  paso('Autenticación', true, `usuario "${me.slug}", roles: ${me.roles.join(',')}`);
  console.log('     permisos: subir archivos =', !!me.capabilities.upload_files, '| publicar =', !!me.capabilities.publish_posts, '(el rol Autor puede publicar; la app igual enviará siempre draft)');
  r = await api('/wp/v2/types?context=edit'); const t = await r.json();
  paso('Tipos de contenido visibles', r.status === 200, Object.values(t).map(x => `${x.slug}→${x.rest_base}`).join(', '));
  r = await api('/wp/v2/categories?per_page=100'); paso('Categorías', r.status === 200, (await r.json()).map(c => `${c.id}:${c.name}`).join(', '));
  r = await api('/wp/v2/media', { method: 'POST', headers: { 'Content-Type': 'image/png', 'Content-Disposition': 'attachment; filename="prueba-publicador.png"' }, body: png });
  const media = await r.json(); paso('Subir imagen', r.status === 201, r.status === 201 ? `id ${media.id}` : `HTTP ${r.status} ${media.message || ''}`);
  r = await api('/wp/v2/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'PRUEBA publicador (borrar)', content: '<p>Texto de prueba</p>', status: 'draft', featured_media: media.id || 0 }) });
  const post = await r.json(); paso('Crear borrador', r.status === 201 && post.status === 'draft', r.status === 201 ? `id ${post.id}, estado ${post.status}` : `HTTP ${r.status} ${post.message || ''}`);
  if (post.id) { console.log('     editar:', `${WP_URL.replace(/\/$/, '')}/wp-admin/post.php?post=${post.id}&action=edit`); console.log('     vista previa:', post.link);
    const d = await api(`/wp/v2/posts/${post.id}?force=true`, { method: 'DELETE' }); paso('Borrar borrador de prueba', d.status === 200, `HTTP ${d.status}`); }
  if (media.id) { const d = await api(`/wp/v2/media/${media.id}?force=true`, { method: 'DELETE' }); paso('Borrar imagen de prueba', d.status === 200, `HTTP ${d.status}`); }
})().catch(e => { console.error('ERROR de red:', e.message); process.exit(3); });