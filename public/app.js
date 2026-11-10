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
$('f-blog').addEventListener('change', (e) => { if (e.target.name === 'destacada') destacadaSel = e.target.value; });

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

// Al pegar se conserva el formato, pero se sacan las imágenes pegadas (se suben con el botón de Imágenes).
editor.addEventListener('paste', () => setTimeout(() => {
  editor.querySelectorAll('script, style, iframe, object, embed').forEach((n) => n.remove());
  const sueltas = editor.querySelectorAll('img:not([data-imagen])');
  if (sueltas.length) {
    sueltas.forEach((n) => n.remove());
    aviso('Las imágenes pegadas desde otro documento no se pueden usar: subilas con el botón de la sección Imágenes.', true);
  }
}, 0));

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
$('archivos').onchange = (e) => {
  aviso('');
  const tipos = ['image/jpeg', 'image/png', 'image/webp'];
  for (const file of e.target.files) {
    if (imgs.filter((x) => !x.quitada).length >= limites.maxImages) { aviso(`Se pueden subir hasta ${limites.maxImages} imágenes.`, true); break; }
    if (!tipos.includes(file.type)) { aviso(`"${file.name}" no es un JPG, PNG o WebP.`, true); continue; }
    if (file.size > limites.maxImageMb * 1024 * 1024) { aviso(`"${file.name}" pesa más de ${limites.maxImageMb} MB.`, true); continue; }
    imgs.push({ file, url: URL.createObjectURL(file), alt: '', quitada: false });
  }
  e.target.value = '';
  pintarImagenes();
};
function insertarImagen(i) {
  restaurarRango();
  const img = document.createElement('img');
  img.setAttribute('data-imagen', String(i));
  img.src = imgs[i].url;
  img.alt = '';
  img.setAttribute('style', 'max-width:100%');
  document.execCommand('insertHTML', false, img.outerHTML);
}
function quitarImagen(i) {
  imgs[i].quitada = true;
  editor.querySelectorAll(`img[data-imagen="${i}"]`).forEach((n) => n.remove());
  URL.revokeObjectURL(imgs[i].url);
  pintarImagenes();
}

// Arma lo que se envía: renumera las imágenes que quedan y saca las que no son de la lista.
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
  pintarImagenes();
  $('vista').hidden = true;
}

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
    li.textContent = `${a.name}${a.role ? ' · ' + a.role : ''}${a.linkUrl ? ' (' + a.linkUrl + ')' : ''}${a.active ? '' : ' [desactivado]'} `;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = a.active ? 'Desactivar' : 'Activar';
    b.onclick = async () => {
      try { await api('PATCH', '/authors/' + a.id, { active: !a.active }); await cargarAutores(); } catch (err) { aviso(err.message, true); }
    };
    li.appendChild(b);
    ul.appendChild(li);
  }
}
enviar($('f-autor'), async (d) => {
  await api('POST', '/authors', d);
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
