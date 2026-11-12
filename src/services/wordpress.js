// Cliente mínimo de la API REST de WordPress. Lee la configuración en cada llamada (así las pruebas
// pueden apuntarlo a un WordPress simulado). Los mensajes de ErrorWp son aptos para mostrarse a la
// persona; el detalle técnico queda solo en `detalle` (va al log, nunca a la pantalla).
const { config } = require('../config');

class ErrorWp extends Error {
  constructor(mensaje, { status, detalle } = {}) {
    super(mensaje);
    this.name = 'ErrorWp';
    this.status = status;
    this.detalle = detalle;
  }
}

const autorizacion = () =>
  'Basic ' + Buffer.from(`${config.wp.user}:${config.wp.appPassword.replace(/\s+/g, '')}`).toString('base64');

async function wp(metodo, ruta, { json, cuerpo, headers } = {}) {
  const { url, user, appPassword } = config.wp;
  if (!url || !user || !appPassword) throw new ErrorWp('El servidor no tiene configurada la conexión con WordPress.');
  let r;
  try {
    r = await fetch(`${url}/wp-json${ruta}`, {
      method: metodo,
      headers: { Authorization: autorizacion(), ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json ? JSON.stringify(json) : cuerpo,
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    throw new ErrorWp('No se pudo conectar con WordPress. Probá de nuevo en un rato.', { detalle: e.message });
  }
  let datos = null;
  try { datos = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) {
    const detalle = `HTTP ${r.status} ${(datos && datos.code) || ''} ${(datos && datos.message) || ''}`.trim();
    if (r.status === 401) throw new ErrorWp('WordPress rechazó las credenciales del publicador (puede que se haya revocado la contraseña de aplicación). Avisale a Facundo.', { status: 401, detalle });
    if (r.status === 403) throw new ErrorWp('WordPress no le permite al usuario del publicador hacer esto. Avisale a Facundo.', { status: 403, detalle });
    throw new ErrorWp(`WordPress devolvió un error (${r.status}).`, { status: r.status, detalle });
  }
  return datos;
}

const entidades = (s) => String(s).replace(/&amp;|&#038;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;|&#8221;|&#8220;/g, '"').replace(/&#039;|&#8217;/g, "'");

// Categorías: se guardan 5 minutos para no pedirlas en cada pantalla.
let cacheCategorias = null;
async function categorias({ forzar = false } = {}) {
  if (!forzar && cacheCategorias && Date.now() - cacheCategorias.cuando < 5 * 60 * 1000) return cacheCategorias.lista;
  const datos = await wp('GET', '/wp/v2/categories?per_page=100&hide_empty=false&_fields=id,name,slug');
  const lista = datos.filter((c) => c.slug !== 'uncategorized').map((c) => ({ id: c.id, name: entidades(c.name) }));
  cacheCategorias = { cuando: Date.now(), lista };
  return lista;
}
const limpiarCache = () => { cacheCategorias = null; };

// Etiqueta fija que activa la plantilla "Blog publicador". Si no existe intenta crearla; si el rol no
// puede, devuelve null y el borrador se crea igual (con una advertencia).
async function etiquetaId() {
  const slug = config.wp.tagSlug;
  try {
    const hallada = await wp('GET', `/wp/v2/tags?slug=${encodeURIComponent(slug)}&_fields=id`);
    if (hallada.length) return hallada[0].id;
    const creada = await wp('POST', '/wp/v2/tags', { json: { name: slug, slug } });
    return creada.id;
  } catch (e) {
    console.error('Etiqueta del publicador:', e.detalle || e.message);
    return null;
  }
}

async function subirImagen({ buffer, mime, nombre }) {
  const m = await wp('POST', '/wp/v2/media', {
    cuerpo: buffer,
    headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="${nombre}"` },
  });
  return { id: m.id, url: m.source_url };
}

const borrarMedio = (id) => wp('DELETE', `/wp/v2/media/${id}?force=true`);

// El estado va fijo en "draft": nunca se publica desde acá.
async function crearBorrador({ titulo, contenido, categoriaId, destacadaId, etiquetaIdValor }) {
  const p = await wp('POST', '/wp/v2/posts', {
    json: {
      title: titulo,
      content: contenido,
      status: 'draft',
      categories: [categoriaId],
      ...(destacadaId ? { featured_media: destacadaId } : {}),
      ...(etiquetaIdValor ? { tags: [etiquetaIdValor] } : {}),
    },
  });
  return {
    id: p.id,
    link: p.link,
    editUrl: `${config.wp.url}/wp-admin/post.php?post=${p.id}&action=edit`,
  };
}

// Estado actual en WordPress de varias entradas (las del usuario del publicador). Las que no aparecen se borraron.
async function estados(ids) {
  if (!ids.length) return new Map();
  const lista = await wp('GET', `/wp/v2/posts?include=${ids.join(',')}&status=publish,future,draft,pending,private,trash&per_page=100&context=edit&_fields=id,status,link`);
  return new Map(lista.map((p) => [p.id, { estado: p.status, link: p.link }]));
}

module.exports = { estados, ErrorWp, categorias, limpiarCache, etiquetaId, subirImagen, borrarMedio, crearBorrador };
