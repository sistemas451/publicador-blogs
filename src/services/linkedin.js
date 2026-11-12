// "Traer desde LinkedIn": lee los datos PÚBLICOS de un posteo (los que LinkedIn publica para buscadores y vistas
// previas: el bloque schema.org SocialMediaPosting y, si el posteo trae un documento, el visor público de sus
// páginas). Un pedido por cada vez que alguien pega un link, identificado como lo que es. No usa sesiones, no se
// hace pasar por un navegador ni reintenta para esquivar un rechazo: si LinkedIn no da los datos, se avisa y se
// carga a mano.
const { config } = require('../config');
const { escapar, tipoDeImagen } = require('./contenido');

class ErrorLinkedin extends Error {
  constructor(mensaje, status = 422) { super(mensaje); this.status = status; }
}

const AGENTE = 'publicador-blogs/1.0 (vista previa de enlaces)';
const esPagina = (h) => h === 'lnkd.in' || h === 'linkedin.com' || h.endsWith('.linkedin.com');
const esMedio = (h) => h === 'media.licdn.com';
const MAX_PAGINA = 3 * 1024 * 1024;

function urlValida(texto, hostOk) {
  let u;
  try { u = new URL(String(texto || '').trim()); } catch { return null; }
  return u.protocol === 'https:' && hostOk(u.hostname) ? u : null;
}

// Pide una dirección siguiendo las redirecciones a mano, para controlar que cada salto quede en un host permitido.
async function pedir(fetchFn, url, hostOk, maxBytes) {
  let actual = url;
  for (let saltos = 0; saltos < 5; saltos++) {
    const r = await fetchFn(actual.href, { redirect: 'manual', headers: { 'User-Agent': AGENTE, Accept: '*/*' }, signal: AbortSignal.timeout(15000) });
    if (r.status >= 300 && r.status < 400) {
      const sig = urlValida(new URL(r.headers.get('location') || '', actual).href, hostOk);
      if (!sig) throw new ErrorLinkedin('El link lleva a una página que no es de LinkedIn.');
      actual = sig;
      continue;
    }
    if (!r.ok) throw new ErrorLinkedin(`LinkedIn no devolvió el posteo (${r.status}). Cargalo a mano.`, 502);
    const largo = Number(r.headers.get('content-length') || 0);
    if (largo > maxBytes) throw new ErrorLinkedin('La respuesta de LinkedIn es demasiado grande.', 502);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > maxBytes) throw new ErrorLinkedin('La respuesta de LinkedIn es demasiado grande.', 502);
    return { buf, tipo: r.headers.get('content-type') || '', url: actual };
  }
  throw new ErrorLinkedin('El link tiene demasiadas redirecciones.');
}

const desescapar = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function bloquePosteo(html) {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      for (const x of Array.isArray(j) ? j : [j]) if (x && x['@type'] === 'SocialMediaPosting') return x;
    } catch { /* otro bloque */ }
  }
  return null;
}

const urlsDe = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => (typeof x === 'string' ? x : x && (x.url || x.contentUrl))).filter(Boolean);

// Texto de LinkedIn → HTML: un párrafo por bloque (separados por renglón en blanco); dentro de un bloque cada
// renglón queda con <br> (la limpieza lo convierte en párrafos aparte, como el texto pegado).
function textoAHtml(texto) {
  return texto.replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
    .map((b) => `<p>${b.split('\n').map((l) => escapar(l.trim())).join('<br>')}</p>`).join('');
}

// Título propuesto: la primera oración (LinkedIn no tiene título de posteo).
function tituloDe(texto) {
  // Corta en el primer fin de oración (. ! ?) seguido de mayúscula, salvo una inicial ("Eduardo U. García").
  const primera = texto.trim().split(/\n|(?<=[!?])\s+|(?<=\.)(?<!(?:^|\s)\p{Lu}\.)\s+(?=[\p{Lu}¿¡])/u)[0].trim();
  return primera.length > 120 ? primera.slice(0, 117).replace(/\s+\S*$/, '') + '…' : primera;
}

async function traer(enlace, { fetchFn = fetch } = {}) {
  const url = urlValida(enlace, esPagina);
  if (!url) throw new ErrorLinkedin('Pegá el link de un posteo de LinkedIn (https://lnkd.in/... o https://www.linkedin.com/posts/...).', 400);
  const { buf } = await pedir(fetchFn, url, esPagina, MAX_PAGINA);
  const html = buf.toString('utf8');
  const posteo = bloquePosteo(html);
  const texto = posteo && String(posteo.articleBody || posteo.text || '').trim();
  if (!texto) throw new ErrorLinkedin('LinkedIn no muestra el texto de ese posteo sin iniciar sesión (puede no ser público). Cargalo a mano.', 502);

  const advertencias = [];
  const plano = desescapar(html);
  let tipo = 'texto';
  let candidatas = urlsDe(posteo.image);
  if (candidatas.length) tipo = 'foto';
  // Documento (carrusel): las páginas del visor público, en 1290 px (o la resolución más cercana).
  const manifiesto = plano.match(/"manifestUrl":"(https:[^"]+)"/);
  if (manifiesto) {
    try {
      const mu = urlValida(manifiesto[1], esMedio);
      const m = mu && JSON.parse((await pedir(fetchFn, mu, esMedio, 200 * 1024)).buf.toString('utf8'));
      const res = (m.perResolutions || []).slice().sort((a, b) => Math.abs(a.width - 1290) - Math.abs(b.width - 1290))[0];
      const iu = res && urlValida(res.imageManifestUrl, esMedio);
      const paginas = iu ? JSON.parse((await pedir(fetchFn, iu, esMedio, 200 * 1024)).buf.toString('utf8')).pages || [] : [];
      if (paginas.length) { candidatas = paginas; tipo = 'documento'; }
    } catch (e) {
      const tapa = [...plano.matchAll(/"coverPages":\[([\s\S]*?)\]/g)].flatMap((x) => [...x[1].matchAll(/"src":"(https:[^"]+)"/g)].map((y) => y[1]));
      if (tapa.length) { candidatas = tapa; tipo = 'documento'; advertencias.push('Del documento solo se pudieron traer las primeras páginas.'); }
    }
  }
  if (candidatas.length > config.maxImages) {
    advertencias.push(`El posteo tiene ${candidatas.length} imágenes; se trajeron las primeras ${config.maxImages}.`);
    candidatas = candidatas.slice(0, config.maxImages);
  }

  const imagenes = [];
  for (const [i, c] of candidatas.entries()) {
    const u = urlValida(c, esMedio);
    if (!u) continue;
    try {
      const { buf: b } = await pedir(fetchFn, u, esMedio, config.maxImageMb * 1024 * 1024);
      const t = tipoDeImagen(b);
      if (!t) throw new Error('no es una imagen');
      imagenes.push({ nombre: `linkedin-${i + 1}.${t.ext}`, mime: t.mime, datos: b.toString('base64') });
    } catch {
      advertencias.push(`No se pudo traer la imagen ${i + 1}; si hace falta, subila a mano.`);
    }
  }
  if (tipo === 'texto') advertencias.push('El posteo no tiene imágenes públicas: si lleva alguna, subila a mano.');

  return {
    titulo: tituloDe(texto),
    html: textoAHtml(texto),
    autor: posteo.author && posteo.author.name ? String(posteo.author.name) : null,
    fecha: posteo.datePublished || null,
    tipo,
    imagenes,
    advertencias,
  };
}

module.exports = { traer, ErrorLinkedin, textoAHtml, tituloDe };
