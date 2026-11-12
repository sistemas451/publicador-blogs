// Pantallas del publicador, sin estilo. Todo el texto de usuarios y borradores se inserta con textContent;
// el único innerHTML es el de la vista previa, que viene ya limpiado por el servidor.
const $ = (id) => document.getElementById(id);
const formularios = ['f-login', 'f-olvide', 'f-clave'];
let usuario = null;

function mostrar(id) {
  for (const f of formularios) $(f).hidden = f !== id;
  $('panel').hidden = id !== 'panel';
}
function aviso(texto, error) {
  $('mensaje').textContent = texto || '';
  $('mensaje').style.color = error ? 'crimson' : 'green';
}
async function api(metodo, ruta, cuerpo) {
  const r = await fetch('/api' + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  let json = {};
  try { json = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) throw new Error(json.error || 'Algo salió mal.');
  return json;
}
async function apiForm(metodo, ruta, fd) {
  const r = await fetch('/api' + ruta, { method: metodo, body: fd });
  let json = {};
  try { json = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) throw new Error(json.error || 'Algo salió mal.');
  return json;
}
const datos = (form) => Object.fromEntries(new FormData(form).entries());
const enviar = (form, fn) => form.addEventListener('submit', async (e) => {
  e.preventDefault();
  aviso('');
  try { await fn(datos(form)); } catch (err) { aviso(err.message, true); }
});
const fecha = (iso) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

// ---------- Vistas del panel ----------
const VISTAS = ['nuevo', 'lista', 'usuarios', 'autores'];
async function irA(vista) {
  aviso('');
  for (const v of VISTAS) $('v-' + v).hidden = v !== vista;
  try {
    if (vista === 'nuevo') await prepararFormulario();
    if (vista === 'lista') await cargarBorradores();
    if (vista === 'usuarios') await cargarUsuarios();
    if (vista === 'autores') await cargarAutores();
  } catch (err) { aviso(err.message, true); }
}
document.querySelectorAll('[data-vista]').forEach((b) => { b.onclick = () => irA(b.dataset.vista); });

async function mostrarPanel(user) {
  usuario = user;
  mostrar('panel');
  $('yo').textContent = `${user.name} (${user.email})`;
  $('nav-usuarios').hidden = !user.isAdmin;
  $('nav-autores').hidden = !user.isAdmin;
  await irA('nuevo');
}

// ---------- Nuevo blog ----------
const editor = $('editor');
let limites = { maxImages: 10, maxImageMb: 5 };
let categoriasListas = false;
let imgs = []; // { file, url, alt, quitada }
let rango = null; // última selección dentro del editor
let destacadaSel = ''; // imagen destacada elegida ('' = ninguna); se recuerda porque la lista se vuelve a pintar
let sinDestacadaElegida = false; // la persona marcó "Sin imagen destacada": no se elige una sola
$('f-blog').addEventListener('change', (e) => {
  if (e.target.name === 'destacada') { destacadaSel = e.target.value; sinDestacadaElegida = e.target.value === ''; }
});

async function prepararFormulario() {
  const f = $('f-blog');
  await cargarSelectorAutores();
  if (categoriasListas) return;
  const r = await api('GET', '/categories');
  limites = r.limits || limites;
  $('limites').textContent = `Hasta ${limites.maxImages} imágenes por blog, de hasta ${limites.maxImageMb} MB cada una (JPG, PNG o WebP).`;
  const sel = f.elements.categoryId;
  sel.replaceChildren();
  const vacio = document.createElement('option');
  vacio.value = ''; vacio.textContent = '— Elegí una categoría —';
  sel.appendChild(vacio);
  for (const c of r.categories) {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name;
    sel.appendChild(o);
  }
  categoriasListas = true;
  elegirCategoriaUnica();
}
// Si la web tiene una sola categoría, queda elegida.
function elegirCategoriaUnica() {
  const sel = $('f-blog').elements.categoryId;
  if (!sel.value && sel.options.length === 2) sel.selectedIndex = 1;
}

// Selección del editor (los botones le sacan el foco, así que se guarda y se restaura).
document.addEventListener('selectionchange', () => {
  const s = getSelection();
  if (s.rangeCount && editor.contains(s.anchorNode)) rango = s.getRangeAt(0).cloneRange();
});
function restaurarRango() {
  editor.focus();
  if (rango) { const s = getSelection(); s.removeAllRanges(); s.addRange(rango); }
}

document.querySelectorAll('#barra [data-cmd]').forEach((b) => {
  b.onmousedown = (e) => e.preventDefault();
  b.onclick = () => {
    restaurarRango();
    const v = b.dataset.valor;
    document.execCommand(b.dataset.cmd, false, v ? `<${v}>` : null);
  };
});
$('b-enlace').onmousedown = (e) => e.preventDefault();
$('b-enlace').onclick = () => {
  restaurarRango();
  const url = prompt('Dirección del enlace (https://...)');
  if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) document.execCommand('createLink', false, url.trim());
  else if (url) aviso('El enlace tiene que empezar con https://', true);
};

// Pegar: una imagen copiada (captura, foto copiada del navegador o de WhatsApp) se agrega a la lista y queda donde
// estaba el cursor. Si se pega texto con formato, se conserva; de las imágenes que vengan adentro solo se pueden
// usar las que traen sus datos (data:); las que apuntan a otra página se sacan con un aviso.
editor.addEventListener('paste', async (e) => {
  const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter((f) => f.type.startsWith('image/'));
  const html = e.clipboardData ? e.clipboardData.getData('text/html') : '';
  if (files.length && !html) {
    e.preventDefault();
    aviso('');
    for (const i of await agregarArchivos(files)) insertarImagen(i);
    return;
  }
  setTimeout(async () => {
    editor.querySelectorAll('script, style, iframe, object, embed').forEach((n) => n.remove());
    let descartadas = 0;
    for (const n of [...editor.querySelectorAll('img:not([data-imagen])')]) {
      const src = n.getAttribute('src') || '';
      if (src.startsWith('data:image/')) {
        const blob = await (await fetch(src)).blob();
        const [i] = await agregarArchivos([new File([blob], 'pegada.' + (blob.type.split('/')[1] || 'png'), { type: blob.type })]);
        if (i !== undefined) { n.replaceWith(marcador(i)); continue; }
      }
      n.remove();
      descartadas++;
    }
    if (descartadas) aviso('Algunas imágenes del texto pegado no se pudieron tomar: copialas de a una y pegalas, o subilas en la sección Imágenes.', true);
  }, 0);
});

function pintarImagenes() {
  const ol = $('imagenes');
  ol.replaceChildren();
  imgs.forEach((im, i) => {
    if (im.quitada) return;
    const li = document.createElement('li');
    const mini = document.createElement('img');
    mini.src = im.url; mini.alt = ''; mini.width = 80;
    li.append(mini, ` ${im.file.name} (${(im.file.size / 1024 / 1024).toFixed(1)} MB) `);
    const alt = document.createElement('input');
    alt.type = 'text'; alt.placeholder = 'Texto alternativo (describe la imagen)'; alt.size = 40; alt.maxLength = 200; alt.value = im.alt;
    alt.oninput = () => { im.alt = alt.value; };
    const ins = document.createElement('button');
    ins.type = 'button'; ins.textContent = 'Insertar en el texto';
    ins.onclick = () => insertarImagen(i);
    const quitar = document.createElement('button');
    quitar.type = 'button'; quitar.textContent = 'Quitar';
    quitar.onclick = () => quitarImagen(i);
    const lab = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'destacada'; radio.value = String(i);
    radio.checked = destacadaSel === String(i);
    lab.append(radio, ' Destacada');
    li.append(alt, ' ', ins, ' ', lab, ' ', quitar);
    ol.appendChild(li);
  });
  if (!imgs.some((im, i) => !im.quitada && destacadaSel === String(i))) destacadaSel = '';
  if (destacadaSel === '') document.querySelector('input[name="destacada"][value=""]').checked = true;
}
// Fotos muy pesadas o muy grandes (las del celular suelen pasar los 5 MB): se achican a 2560 px como máximo y se
// guardan en JPG, en vez de rechazarlas.
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const LADO_MAX = 2560;
async function prepararImagen(file) {
  if (!TIPOS.includes(file.type)) return { error: `"${file.name || 'La imagen'}" no es un JPG, PNG o WebP.` };
  let bm = null;
  try { bm = await createImageBitmap(file); } catch { return { error: `"${file.name || 'La imagen'}" no se pudo leer.` }; }
  const grande = Math.max(bm.width, bm.height) > LADO_MAX;
  if (!grande && file.size <= limites.maxImageMb * 1024 * 1024) { bm.close(); return { file }; }
  const k = Math.min(1, LADO_MAX / Math.max(bm.width, bm.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bm, 0, 0, c.width, c.height);
  bm.close();
  for (const q of [0.85, 0.7, 0.55]) {
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= limites.maxImageMb * 1024 * 1024) {
      const nombre = (file.name || 'imagen').replace(/\.\w+$/, '') + '.jpg';
      return { file: new File([blob], nombre, { type: 'image/jpeg' }), achicada: true };
    }
  }
  return { error: `"${file.name || 'La imagen'}" pesa demasiado aun achicándola.` };
}
// Agrega archivos a la lista. Devuelve los índices agregados. La primera imagen queda como destacada si no hay otra.
async function agregarArchivos(files) {
  const nuevos = [];
  for (const f of files) {
    if (imgs.filter((x) => !x.quitada).length >= limites.maxImages) { aviso(`Se pueden subir hasta ${limites.maxImages} imágenes.`, true); break; }
    const r = await prepararImagen(f);
    if (r.error) { aviso(r.error, true); continue; }
    if (r.achicada) aviso(`"${r.file.name}" era muy grande y se achicó.`);
    imgs.push({ file: r.file, url: URL.createObjectURL(r.file), alt: '', quitada: false });
    nuevos.push(imgs.length - 1);
  }
  if (nuevos.length && destacadaSel === '' && !sinDestacadaElegida) destacadaSel = String(nuevos[0]);
  pintarImagenes();
  return nuevos;
}
$('archivos').onchange = async (e) => {
  aviso('');
  const files = [...e.target.files];
  e.target.value = '';
  await agregarArchivos(files);
};
const marcador = (i) => {
  const img = document.createElement('img');
  img.setAttribute('data-imagen', String(i));
  img.src = imgs[i].url;
  img.alt = '';
  img.setAttribute('style', 'max-width:100%');
  return img;
};
function insertarImagen(i) {
  restaurarRango();
  document.execCommand('insertHTML', false, marcador(i).outerHTML);
}
// Carrusel: un bloque con varias imágenes que en la web se ven de a una, deslizables (la plantilla le pone las
// flechas). En el editor se muestra como una tira horizontal con borde punteado.
function estiloCarrusel(div, enVista) {
  div.setAttribute('style', enVista
    ? 'display:flex;overflow-x:auto;scroll-snap-type:x mandatory;max-width:800px'
    : 'display:flex;gap:8px;overflow-x:auto;border:2px dashed #888;padding:6px;margin:8px 0');
  div.querySelectorAll('figure').forEach((f) => f.setAttribute('style', enVista ? 'flex:0 0 100%;margin:0;scroll-snap-align:start' : 'flex:0 0 220px;margin:0'));
  div.querySelectorAll('img').forEach((im) => im.setAttribute('style', 'width:100%;height:auto;display:block'));
}
function carrusel(indices) {
  const div = document.createElement('div');
  div.setAttribute('data-carrusel', '1');
  div.setAttribute('contenteditable', 'false');
  indices.forEach((i) => { const f = document.createElement('figure'); f.appendChild(marcador(i)); div.appendChild(f); });
  estiloCarrusel(div, false);
  return div;
}
$('b-carrusel').onclick = () => {
  const usadas = new Set([...editor.querySelectorAll('img[data-imagen]')].map((n) => Number(n.getAttribute('data-imagen'))));
  const libres = imgs.map((im, i) => i).filter((i) => !imgs[i].quitada && !usadas.has(i));
  if (libres.length < 2) { aviso('Para un carrusel hacen falta al menos 2 imágenes que todavía no estén en el texto.', true); return; }
  restaurarRango();
  document.execCommand('insertHTML', false, carrusel(libres).outerHTML + '<p><br></p>');
  aviso(`Se armó un carrusel con ${libres.length} imágenes.`);
};

// Arrastrar imágenes al texto: se agregan a la lista y quedan donde se soltaron.
editor.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
editor.addEventListener('drop', async (e) => {
  const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
  if (r && editor.contains(r.startContainer)) rango = r;
  aviso('');
  for (const i of await agregarArchivos(files)) insertarImagen(i);
});
function quitarImagen(i) {
  imgs[i].quitada = true;
  editor.querySelectorAll(`img[data-imagen="${i}"]`).forEach((n) => {
    const fig = n.closest('figure'); const car = n.closest('[data-carrusel]');
    n.remove();
    if (fig && !fig.querySelector('img')) fig.remove();
    if (car && !car.querySelector('img')) car.remove();
  });
  URL.revokeObjectURL(imgs[i].url);
  pintarImagenes();
}

// Arma lo que se envía: renumera las imágenes que quedan y saca las que no son de la lista.
// Al escribir en el editor, el navegador deja el primer renglón como texto suelto (sin párrafo) y los
// siguientes en <div>. Junta el texto y los elementos de línea sueltos del primer nivel en un <p>.
const DE_LINEA = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'A', 'SPAN', 'BR', 'IMG', 'SUB', 'SUP', 'CODE']);
function envolverSueltos(raiz) {
  let p = null;
  for (const n of [...raiz.childNodes]) {
    const suelto = n.nodeType === 3 ? n.textContent.trim() !== '' || p : n.nodeType === 1 && DE_LINEA.has(n.tagName);
    if (!suelto) { p = null; continue; }
    if (n.nodeType === 1 && n.tagName === 'BR' && !p) { n.remove(); continue; }
    if (!p) { p = document.createElement('p'); raiz.insertBefore(p, n); }
    p.appendChild(n);
  }
}

function construir() {
  const activas = imgs.map((im, i) => ({ im, i })).filter((x) => !x.im.quitada);
  const mapa = new Map(activas.map((x, k) => [x.i, k]));
  const clon = editor.cloneNode(true);
  clon.querySelectorAll('img').forEach((img) => {
    const n = img.getAttribute('data-imagen');
    const k = n === null ? undefined : mapa.get(Number(n));
    if (k === undefined) { img.remove(); return; }
    img.setAttribute('data-imagen', String(k));
    img.setAttribute('alt', activas[k].im.alt || '');
    img.removeAttribute('src');
    img.removeAttribute('style');
  });
  envolverSueltos(clon);
  const marcada = document.querySelector('input[name="destacada"]:checked');
  const k = marcada && marcada.value !== '' ? mapa.get(Number(marcada.value)) : undefined;
  return { html: clon.innerHTML, files: activas.map((x) => x.im.file), urls: activas.map((x) => x.im.url), featured: k === undefined ? '' : k };
}

$('b-previa').onclick = async () => {
  aviso('');
  try {
    const f = $('f-blog');
    const c = construir();
    const { html } = await api('POST', '/preview', { html: c.html });
    const cont = $('vista-contenido');
    cont.replaceChildren();
    const h = document.createElement('h1');
    h.textContent = f.elements.title.value || '(sin título)';
    cont.appendChild(h);
    const cat = f.elements.categoryId.selectedOptions[0];
    if (cat && cat.value) { const p = document.createElement('p'); p.textContent = `Categoría: ${cat.textContent}`; cont.appendChild(p); }
    if (c.featured !== '') {
      const d = document.createElement('img');
      d.src = c.urls[c.featured]; d.alt = 'Imagen destacada'; d.style.maxWidth = '100%';
      const p = document.createElement('p');
      p.append('Imagen destacada:', document.createElement('br'), d);
      cont.appendChild(p);
    }
    const opcion = f.elements.authorId.selectedOptions[0];
    const autor = opcion && opcion.value ? opcion.textContent : '';
    if (autor) { const p = document.createElement('p'); const em = document.createElement('em'); em.textContent = `Por ${autor}`; p.appendChild(em); cont.appendChild(p); }
    const cuerpo = document.createElement('div');
    cuerpo.innerHTML = html; // ya limpiado por el servidor
    cuerpo.querySelectorAll('img[data-imagen]').forEach((img) => {
      img.src = c.urls[Number(img.getAttribute('data-imagen'))] || '';
      img.removeAttribute('data-imagen');
      img.style.maxWidth = '100%';
    });
    cuerpo.querySelectorAll('[data-carrusel]').forEach((d) => estiloCarrusel(d, true));
    cont.appendChild(cuerpo);
    $('vista').hidden = false;
    $('vista').scrollIntoView();
  } catch (err) { aviso(err.message, true); }
};

function limpiarFormulario() {
  $('f-blog').reset();
  editor.replaceChildren();
  imgs.forEach((im) => URL.revokeObjectURL(im.url));
  imgs = [];
  destacadaSel = '';
  sinDestacadaElegida = false;
  pintarImagenes();
  elegirCategoriaUnica();
  $('vista').hidden = true;
}

// ---------- Traer desde LinkedIn ----------
// Compara nombres sin acentos ni mayúsculas: un autor de la lista coincide si todas sus palabras están en el
// nombre que da LinkedIn ("Nicolás García Naino" ↔ "Nicolas Javier Garcia Naino").
const palabras = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
function autorQueCoincide(nombre) {
  if (!nombre) return null;
  const de = new Set(palabras(nombre));
  const sel = $('f-blog').elements.authorId;
  const cand = [...sel.options].filter((o) => o.value && palabras(o.textContent).every((p) => de.has(p)));
  return cand.length === 1 ? cand[0].value : null;
}
$('b-traer').onclick = async () => {
  aviso('');
  const url = $('li-url').value.trim();
  if (!url) { aviso('Pegá el link del posteo de LinkedIn.', true); return; }
  const hayAlgo = editor.textContent.trim() || imgs.some((x) => !x.quitada) || $('f-blog').elements.title.value.trim();
  if (hayAlgo && !confirm('Esto reemplaza el título, el texto y las imágenes que ya cargaste. ¿Seguir?')) return;
  const b = $('b-traer');
  b.disabled = true; b.textContent = 'Trayendo...';
  try {
    const r = await api('POST', '/linkedin', { url });
    // Se empieza de cero (sin tocar la categoría).
    const f = $('f-blog');
    imgs.forEach((im) => URL.revokeObjectURL(im.url));
    imgs = []; destacadaSel = ''; sinDestacadaElegida = false;
    f.elements.title.value = r.titulo || '';
    editor.innerHTML = r.html;
    const autor = autorQueCoincide(r.autor);
    if (autor) f.elements.authorId.value = autor;
    const files = r.imagenes.map((im) => {
      const bin = atob(im.datos); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new File([arr], im.nombre, { type: im.mime });
    });
    const idx = await agregarArchivos(files);
    // Un documento va completo, como carrusel, al final del texto; una foto sola queda solo como destacada.
    if (r.tipo === 'documento' && idx.length > 1) editor.appendChild(carrusel(idx));
    const notas = [`Listo: se trajo el texto${idx.length ? ` y ${idx.length === 1 ? '1 imagen' : idx.length + ' imágenes'}` : ''}.`];
    if (!autor) notas.push(r.autor ? `El autor de LinkedIn (${r.autor}) no está en la lista: elegilo a mano.` : 'Elegí el autor.');
    notas.push('Revisá el título (es la primera oración del posteo) y el texto antes de crear el borrador.');
    aviso([...notas, ...r.advertencias].join(' '));
  } catch (err) {
    aviso(err.message, true);
  } finally {
    b.disabled = false; b.textContent = 'Traer y completar';
  }
};

$('f-blog').addEventListener('submit', async (e) => {
  e.preventDefault();
  aviso('');
  $('resultado').replaceChildren();
  const f = e.target;
  const boton = $('b-crear');
  boton.disabled = true;
  boton.textContent = 'Creando el borrador…';
  try {
    const c = construir();
    const fd = new FormData();
    fd.append('title', f.elements.title.value);
    fd.append('categoryId', f.elements.categoryId.value);
    fd.append('authorId', f.elements.authorId.value);
    fd.append('html', c.html);
    if (c.featured !== '') fd.append('featured', String(c.featured));
    c.files.forEach((file) => fd.append('imagenes', file));
    const r = await fetch('/api/drafts', { method: 'POST', body: fd, credentials: 'same-origin' });
    let json = {};
    try { json = await r.json(); } catch { /* sin cuerpo */ }
    if (!r.ok) throw new Error(json.error || 'No se pudo crear el borrador.');
    const res = $('resultado');
    const p = document.createElement('p');
    p.style.color = 'green';
    p.textContent = `Listo: el borrador "${json.draft.title}" quedó creado. Facundo lo va a revisar y publicar.`;
    res.appendChild(p);
    for (const a of json.advertencias || []) { const w = document.createElement('p'); w.style.color = 'darkorange'; w.textContent = a; res.appendChild(w); }
    if (usuario && usuario.isAdmin && json.draft.wpEditUrl) {
      const a = document.createElement('a');
      a.href = json.draft.wpEditUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Abrir el borrador en WordPress';
      res.appendChild(a);
    }
    limpiarFormulario();
  } catch (err) {
    aviso(err.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = 'Crear borrador';
  }
});

// Avisa antes de cerrar la pestaña si hay un blog a medio escribir.
window.addEventListener('beforeunload', (e) => {
  if (!$('panel').hidden && (editor.textContent.trim() || $('f-blog').elements.title.value.trim())) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- Lista de borradores ----------
async function cargarBorradores() {
  const { drafts } = await api('GET', '/drafts');
  const ul = $('borradores');
  ul.replaceChildren();
  if (!drafts.length) { const li = document.createElement('li'); li.textContent = 'Todavía no hay borradores.'; ul.appendChild(li); return; }
  for (const d of drafts) {
    const li = document.createElement('li');
    li.textContent = `${fecha(d.createdAt)} — ${d.title} — ${d.status === 'CREADO' ? 'creado' : 'no se pudo crear'}${usuario.isAdmin ? ` — por ${d.by}` : ''} `;
    if (usuario.isAdmin && d.wpEditUrl) {
      const a = document.createElement('a');
      a.href = d.wpEditUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Abrir en WordPress';
      li.appendChild(a);
    }
    ul.appendChild(li);
  }
}

// ---------- Autores ----------
async function cargarSelectorAutores() {
  const sel = $('f-blog').elements.authorId;
  const elegido = sel.value;
  const { authors } = await api('GET', '/authors');
  sel.replaceChildren();
  const vacio = document.createElement('option');
  vacio.value = ''; vacio.textContent = authors.length ? '— Elegí el autor —' : '(todavía no hay autores: pedile al administrador que los cargue)';
  sel.appendChild(vacio);
  for (const a of authors) {
    const o = document.createElement('option');
    o.value = a.id; o.textContent = a.name;
    sel.appendChild(o);
  }
  if (authors.some((a) => a.id === elegido)) sel.value = elegido;
}
async function cargarAutores() {
  const { authors } = await api('GET', '/authors?todos=1');
  const ul = $('autores');
  ul.replaceChildren();
  for (const a of authors) {
    const li = document.createElement('li');
    if (a.photoUrl) {
      const f = document.createElement('img');
      f.src = a.photoUrl; f.alt = ''; f.width = 40; f.height = 40; f.style.cssText = 'border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:8px';
      li.appendChild(f);
    }
    li.append(`${a.name}${a.role ? ' · ' + a.role : ''}${a.linkUrl ? ' (' + a.linkUrl + ')' : ''}${a.active ? '' : ' [desactivado]'} `);
    const cambiar = document.createElement('input');
    cambiar.type = 'file'; cambiar.accept = 'image/jpeg,image/png,image/webp'; cambiar.title = a.photoUrl ? 'Cambiar foto' : 'Agregar foto';
    cambiar.onchange = async () => {
      if (!cambiar.files[0]) return;
      const fd = new FormData(); fd.append('foto', cambiar.files[0]);
      try { aviso('Subiendo la foto...'); await apiForm('PATCH', '/authors/' + a.id, fd); aviso('Foto actualizada.'); await cargarAutores(); } catch (err) { aviso(err.message, true); }
    };
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = a.active ? 'Desactivar' : 'Activar';
    b.onclick = async () => {
      try { await api('PATCH', '/authors/' + a.id, { active: !a.active }); await cargarAutores(); } catch (err) { aviso(err.message, true); }
    };
    li.append(b, ' ', cambiar);
    ul.appendChild(li);
  }
}
enviar($('f-autor'), async () => {
  const fd = new FormData($('f-autor'));
  if (!fd.get('foto') || !fd.get('foto').size) fd.delete('foto');
  await apiForm('POST', '/authors', fd);
  $('f-autor').reset();
  aviso('Autor agregado.');
  await cargarAutores();
});

// ---------- Usuarios (administrador) ----------
async function cargarUsuarios() {
  const { users } = await api('GET', '/users');
  const ul = $('usuarios');
  ul.replaceChildren();
  for (const u of users) {
    const li = document.createElement('li');
    li.textContent = `${u.name} <${u.email}>${u.isAdmin ? ' [admin]' : ''}${u.pendiente ? ' [pendiente]' : ''}${u.active ? '' : ' [desactivado]'} `;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = u.active ? 'Desactivar' : 'Activar';
    b.onclick = async () => {
      try { await api('PATCH', '/users/' + u.id, { active: !u.active }); await cargarUsuarios(); } catch (err) { aviso(err.message, true); }
    };
    li.appendChild(b);
    ul.appendChild(li);
  }
}
enviar($('f-invitar'), async (d) => {
  await api('POST', '/users/invite', d);
  $('f-invitar').reset();
  aviso('Invitación enviada.');
  await cargarUsuarios();
});

// ---------- Ingreso, recuperación y enlaces del mail ----------
$('ir-olvide').onclick = (e) => { e.preventDefault(); aviso(''); mostrar('f-olvide'); };
$('ir-login').onclick = (e) => { e.preventDefault(); aviso(''); mostrar('f-login'); };

enviar($('f-login'), async (d) => {
  const { user } = await api('POST', '/auth/login', d);
  $('f-login').reset();
  await mostrarPanel(user);
});
enviar($('f-olvide'), async (d) => {
  const r = await api('POST', '/auth/forgot', d);
  aviso(r.mensaje);
});
$('salir').onclick = async () => {
  await api('POST', '/auth/logout');
  usuario = null;
  limpiarFormulario();
  aviso('');
  mostrar('f-login');
};

async function pantallaDeEnlace(tipo) {
  const token = new URLSearchParams(location.search).get('token') || '';
  const invitacion = tipo === 'invite';
  $('titulo-clave').textContent = invitacion ? 'Elegí tu contraseña' : 'Contraseña nueva';
  $('fila-nombre').hidden = !invitacion;
  try {
    const c = await api('POST', '/auth/check-token', { token, type: tipo });
    $('quien').textContent = c.email;
    if (invitacion) $('f-clave').elements.name.value = c.name || '';
    mostrar('f-clave');
  } catch (err) {
    aviso(err.message, true);
    mostrar('f-login');
    return;
  }
  enviar($('f-clave'), async (d) => {
    await api('POST', invitacion ? '/auth/accept-invite' : '/auth/reset', { token, password: d.password, name: d.name });
    history.replaceState(null, '', '/');
    $('f-clave').reset();
    mostrar('f-login');
    aviso('Listo. Ya podés ingresar con tu contraseña nueva.');
  });
}

(async () => {
  if (location.pathname === '/aceptar-invitacion') return pantallaDeEnlace('invite');
  if (location.pathname === '/restablecer') return pantallaDeEnlace('reset');
  try {
    const { user } = await api('GET', '/auth/me');
    await mostrarPanel(user);
  } catch {
    mostrar('f-login');
  }
})();
