// Validación de imágenes (por su contenido real, no por el nombre) y limpieza del HTML del blog.
const sanitizeHtml = require('sanitize-html');

class Invalido extends Error {
  constructor(mensaje) { super(mensaje); this.status = 400; }
}

// Tipo real de la imagen por sus primeros bytes. Solo JPG, PNG y WebP.
function tipoDeImagen(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

const ETIQUETAS = ['p', 'br', 'h2', 'h3', 'h4', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'a', 'blockquote', 'img', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption'];

// Sin `urls`: deja las imágenes como marcador (data-imagen="N"); las que no tienen un marcador válido se sacan.
// Con `urls`: reemplaza cada marcador por la dirección de la imagen ya subida a WordPress.
function limpiar(html, urls) {
  return aParrafos(sanitizeHtml(String(html || ''), {
    allowedTags: ETIQUETAS,
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'data-imagen', 'alt'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    transformTags: {
      h1: 'h2',
      div: 'p', // el editor del navegador convierte cada línea pegada en un <div>: pasa a ser un párrafo
      b: 'strong',
      i: 'em',
      // Un enlace sin dirección válida (por ejemplo javascript:) deja solo el texto.
      a: (tag, a) => (/^\s*(https?:|mailto:|tel:)/i.test(a.href || '')
        ? { tagName: 'a', attribs: { href: a.href, target: '_blank', rel: 'noopener noreferrer' } }
        : { tagName: 'span', attribs: {} }),
      img: (tag, a) => {
        const n = /^\d{1,2}$/.test(a['data-imagen'] || '') ? a['data-imagen'] : null;
        if (n === null) return { tagName: 'img', attribs: {} };
        const alt = (a.alt || '').slice(0, 200);
        return urls ? { tagName: 'img', attribs: { ...(urls[n] ? { src: urls[n] } : {}), alt } } : { tagName: 'img', attribs: { 'data-imagen': n, alt } };
      },
    },
    exclusiveFilter: (f) =>
      (f.tag === 'img' && !(urls ? f.attribs.src : f.attribs['data-imagen'])) ||
      // párrafos vacíos (las líneas en blanco del texto pegado), salvo que tengan una imagen
      ((f.tag === 'p' || f.tag === 'div') && f.text.replace(/&nbsp;|\s/g, '') === '' && !f.mediaChildren.length),
  }));
}

// Texto pegado con un salto de línea por renglón llega como UN párrafo con <br>: cada renglón pasa a ser un párrafo.
function aParrafos(html) {
  return html.replace(/<p>([\s\S]*?)<\/p>/g, (m, dentro) => (/<br\s*\/?>/.test(dentro)
    ? dentro.split(/<br\s*\/?>/).map((s) => s.trim()).filter(Boolean).map((s) => `<p>${s}</p>`).join('')
    : m));
}

const indicesUsados = (htmlLimpio) => [...new Set([...htmlLimpio.matchAll(/data-imagen="(\d+)"/g)].map((m) => Number(m[1])))];

const escapar = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// ¿Queda algún texto visible? (para rechazar un blog vacío)
const hayTexto = (html) => sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;|\s/g, '').length > 0;

// Línea del autor al principio del blog: "Por Nombre · Cargo" (el nombre es un enlace si se cargó uno válido).
function lineaDeAutor(a) {
  // Bloque del autor: foto redonda (si hay), nombre grande y cargo debajo. Siempre mide lo mismo (96 px de alto y
  // 72 px de margen abajo): la plantilla "Blog publicador" pone los botones de compartir a su derecha y la fecha
  // justo debajo, y para eso necesita saber dónde termina. Estilos en línea (WordPress los conserva); la clase
  // publicador-autor la usa la plantilla.
  const enlace = /^\s*https?:\/\//i.test(a.linkUrl || '')
    ? ` – <a href="${escapar(a.linkUrl.trim())}" target="_blank" rel="noopener noreferrer" style="color:#c2185b">[Linkedin]</a>` : '';
  const cargo = a.role || enlace ? `<br><span style="color:#777;font-size:0.95em">${escapar(a.role || '')}${a.role ? enlace : enlace.replace(/^ – /, '')}</span>` : '';
  const foto = /^https?:\/\//i.test(a.photoUrl || '')
    ? `<div style="flex:none;line-height:0"><img src="${escapar(a.photoUrl)}" alt="${escapar(a.name)}" width="96" height="96" style="width:96px;height:96px;border-radius:50%;object-fit:cover;margin:0"></div>` : '';
  // Solo <div>: con <p> el formateador de WordPress (wpautop) agrega un párrafo vacío entre la foto y el nombre.
  return `<div class="publicador-autor" style="display:flex;align-items:center;gap:20px;min-height:96px;margin:0 0 72px">${foto}<div><strong style="font-size:1.6em;color:#000">${escapar(a.name)}</strong>${cargo}</div></div>`;
}

module.exports = { Invalido, tipoDeImagen, limpiar, indicesUsados, escapar, hayTexto, lineaDeAutor };
