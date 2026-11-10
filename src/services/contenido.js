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
      b: 'strong',
      i: 'em',
      a: (tag, a) => ({ tagName: 'a', attribs: { ...(a.href ? { href: a.href } : {}), target: '_blank', rel: 'noopener noreferrer' } }),
      img: (tag, a) => {
        const n = /^\d{1,2}$/.test(a['data-imagen'] || '') ? a['data-imagen'] : null;
        if (n === null) return { tagName: 'img', attribs: {} };
        const alt = (a.alt || '').slice(0, 200);
        return urls ? { tagName: 'img', attribs: { ...(urls[n] ? { src: urls[n] } : {}), alt } } : { tagName: 'img', attribs: { 'data-imagen': n, alt } };
      },
    },
    exclusiveFilter: (f) => f.tag === 'img' && !(urls ? f.attribs.src : f.attribs['data-imagen']),
  });
}

const indicesUsados = (htmlLimpio) => [...new Set([...htmlLimpio.matchAll(/data-imagen="(\d+)"/g)].map((m) => Number(m[1])))];

const escapar = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// ¿Queda algún texto visible? (para rechazar un blog vacío)
const hayTexto = (html) => sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;|\s/g, '').length > 0;

module.exports = { Invalido, tipoDeImagen, limpiar, indicesUsados, escapar, hayTexto };
