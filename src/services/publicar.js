// Crea el borrador en WordPress: valida, sube las imágenes, arma el texto y crea la entrada (siempre en
// borrador). Si algo falla a mitad, borra las imágenes que ya había subido para no dejar basura.
const prisma = require('../lib/prisma');
const { config } = require('../config');
const wp = require('./wordpress');
const { Invalido, tipoDeImagen, limpiar, indicesUsados, hayTexto, lineaDeAutor } = require('./contenido');

async function publicar({ user, titulo, categoriaId, autorId, html, archivos, destacada }) {
  // ---- Validación (nada de esto toca WordPress ni la base) ----
  titulo = String(titulo || '').trim();
  if (!titulo || titulo.length > 200) throw new Invalido('Falta el título (hasta 200 caracteres).');
  const autorFila = typeof autorId === 'string' && autorId ? await prisma.author.findUnique({ where: { id: autorId } }) : null;
  if (!autorFila || !autorFila.active) throw new Invalido('Elegí el autor del blog.');
  const autor = autorFila.name;
  if (!Number.isInteger(categoriaId)) throw new Invalido('Elegí una categoría.');
  if (archivos.length > config.maxImages) throw new Invalido(`Se pueden subir hasta ${config.maxImages} imágenes por blog.`);

  const imagenes = archivos.map((f, i) => {
    const t = tipoDeImagen(f.buffer);
    if (!t) throw new Invalido(`La imagen ${i + 1} (${f.originalname.slice(0, 60)}) no es un JPG, PNG o WebP válido.`);
    return { buffer: f.buffer, ...t };
  });

  const limpio = limpiar(html);
  const usadas = indicesUsados(limpio);
  for (const n of usadas) if (!imagenes[n]) throw new Invalido(`El texto usa la imagen ${n + 1}, pero no se subió.`);
  if (!hayTexto(limpio)) throw new Invalido('El blog está vacío.');
  if (destacada !== null && !imagenes[destacada]) throw new Invalido('La imagen destacada elegida no existe.');

  // La categoría tiene que existir en WordPress (se vuelve a pedir la lista si no la encuentra, por si es nueva).
  let cats = await wp.categorias();
  if (!cats.some((c) => c.id === categoriaId)) cats = await wp.categorias({ forzar: true });
  if (!cats.some((c) => c.id === categoriaId)) throw new Invalido('Esa categoría no existe en WordPress.');

  // ---- WordPress ----
  const subidos = [];
  const advertencias = [];
  try {
    const urls = {};
    const aSubir = [...new Set([...usadas, ...(destacada !== null ? [destacada] : [])])].sort((a, b) => a - b);
    const marca = Date.now();
    for (const n of aSubir) {
      const img = imagenes[n];
      const r = await wp.subirImagen({ buffer: img.buffer, mime: img.mime, nombre: `blog-${marca}-${n + 1}.${img.ext}` });
      subidos.push(r.id);
      urls[n] = r.url;
    }
    const lineaAutor = lineaDeAutor(autorFila) + '\n';
    const contenido = lineaAutor + limpiar(limpio, urls);

    const etiqueta = await wp.etiquetaId();
    if (!etiqueta) advertencias.push(`No se pudo asignar la etiqueta "${config.wp.tagSlug}": el borrador se creó pero sin el diseño del blog. Avisale a Facundo.`);

    const post = await wp.crearBorrador({
      titulo,
      contenido,
      categoriaId,
      destacadaId: destacada !== null ? subidos[aSubir.indexOf(destacada)] : null,
      etiquetaIdValor: etiqueta,
    });

    let draft;
    try {
      draft = await prisma.draft.create({
        data: { userId: user.id, title: titulo, wpPostId: post.id, wpEditUrl: post.editUrl, wpLink: post.link, categoryId: categoriaId, authorLine: autor, imageCount: subidos.length, status: 'CREADO' },
      });
    } catch (e) {
      // El borrador ya existe en WordPress: no se lo borra por no poder anotarlo acá.
      console.error('El borrador se creó en WordPress pero no se pudo registrar:', e.message);
      draft = { id: null, title: titulo, wpPostId: post.id, wpEditUrl: post.editUrl, wpLink: post.link, imageCount: subidos.length, status: 'CREADO' };
      advertencias.push('El borrador se creó, pero no quedó anotado en la lista de esta pantalla.');
    }
    return { draft, advertencias };
  } catch (e) {
    for (const id of subidos) await wp.borrarMedio(id).catch((err) => console.error('No se pudo borrar la imagen', id, err.message));
    if (e instanceof wp.ErrorWp) {
      console.error('Falló la publicación:', e.detalle || e.message);
      await prisma.draft
        .create({ data: { userId: user.id, title: titulo, categoryId: categoriaId, authorLine: autor, imageCount: 0, status: 'FALLIDO', error: (e.detalle || e.message).slice(0, 500) } })
        .catch(() => {});
    }
    throw e;
  }
}

module.exports = { publicar };
