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
  return sanitizeHtml(String(html || ''), {
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
  });
}

const indicesUsados = (htmlLimpio) => [...new Set([...htmlLimpio.matchAll(/data-imagen="(\d+)"/g)].map((m) => Number(m[1])))];

const escapar = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// ¿Queda algún texto visible? (para rechazar un blog vacío)
const hayTexto = (html) => sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;|\s/g, '').length > 0;

// Línea del autor al principio del blog: "Por Nombre · Cargo" (el nombre es un enlace si se cargó uno válido).
function lineaDeAutor(a) {
  const nombre = /^\s*https?:\/\//i.test(a.linkUrl || '')
    ? `<a href="${escapar(a.linkUrl.trim())}" target="_blank" rel="noopener noreferrer">${escapar(a.name)}</a>`
    : escapar(a.name);
  if (!/^https?:\/\//i.test(a.photoUrl || '')) return `<p><em>Por ${nombre}${a.role ? ' · ' + escapar(a.role) : ''}</em></p>`;
  // Con foto: bloque con la foto redonda, el nombre grande y el cargo debajo. Los estilos van en línea (la web no
  // tiene una clase para esto); la foto lleva además la clase alignleft por si WordPress recorta algún estilo.
  const enlace = /^\s*https?:\/\//i.test(a.linkUrl || '')
    ? ` – <a href="${escapar(a.linkUrl.trim())}" target="_blank" rel="noopener noreferrer">[Linkedin]</a>` : '';
  const cargo = a.role || enlace ? `<br><span style="color:#777;font-size:0.95em">${escapar(a.role || '')}${a.role ? enlace : enlace.replace(/^ – /, '')}</span>` : '';
  return `<div style="display:flex;align-items:center;gap:16px;margin:0 0 24px"><img class="alignleft" src="${escapar(a.photoUrl)}" alt="${escapar(a.name)}" width="80" height="80" style="width:80px;height:80px;border-radius:50%;object-fit:cover;margin:0"><p style="margin:0"><strong style="font-size:1.5em;color:#000">${escapar(a.name)}</strong>${cargo}</p></div>`;
}

module.exports = { Invalido, tipoDeImagen, limpiar, indicesUsados, escapar, hayTexto, lineaDeAutor };
