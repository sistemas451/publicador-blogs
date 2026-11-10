// Pantalla mínima, sin estilo. Todo el texto se inserta con textContent (nunca innerHTML).
const $ = (id) => document.getElementById(id);
const formularios = ['f-login', 'f-olvide', 'f-clave'];

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

async function mostrarPanel(user) {
  mostrar('panel');
  $('yo').textContent = `${user.name} (${user.email})`;
  $('admin').hidden = !user.isAdmin;
  if (user.isAdmin) await cargarUsuarios();
}

$('ir-olvide').onclick = (e) => { e.preventDefault(); aviso(''); mostrar('f-olvide'); };
$('ir-login').onclick = (e) => { e.preventDefault(); aviso(''); mostrar('f-login'); };

enviar($('f-login'), async (d) => {
  const { user } = await api('POST', '/auth/login', d);
  await mostrarPanel(user);
});
enviar($('f-olvide'), async (d) => {
  const r = await api('POST', '/auth/forgot', d);
  aviso(r.mensaje);
});
enviar($('f-invitar'), async (d) => {
  await api('POST', '/users/invite', d);
  $('f-invitar').reset();
  aviso('Invitación enviada.');
  await cargarUsuarios();
});
$('salir').onclick = async () => {
  await api('POST', '/auth/logout');
  aviso('');
  mostrar('f-login');
};

// Pantallas de enlace (invitación y recuperación)
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
