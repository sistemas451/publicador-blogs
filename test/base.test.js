// Pruebas de la Fase 1: salud, cabeceras de seguridad, CORS y límite de intentos.
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');
const { config } = require('../src/config');

async function levantar() {
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('GET /api/health responde ok', async () => {
  const { server, base } = await levantar();
  const r = await fetch(base + '/api/health');
  const j = await r.json();
  server.close();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(j.status, 'ok');
});

test('cabeceras de seguridad: CSP, sin x-powered-by', async () => {
  const { server, base } = await levantar();
  const r = await fetch(base + '/api/health');
  server.close();
  const csp = r.headers.get('content-security-policy') || '';
  assert.ok(csp.includes("default-src 'self'"), 'falta default-src');
  assert.ok(csp.includes("object-src 'none'"), 'falta object-src none');
  assert.ok(csp.includes("frame-ancestors 'none'"), 'falta frame-ancestors');
  assert.strictEqual(r.headers.get('x-powered-by'), null);
  assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
});

test('CORS: solo el origen de la aplicación', async () => {
  const { server, base } = await levantar();
  const ajeno = await fetch(base + '/api/health', { headers: { Origin: 'https://sitio-ajeno.example' } });
  const propio = await fetch(base + '/api/health', { headers: { Origin: config.appUrl } });
  server.close();
  assert.notStrictEqual(ajeno.headers.get('access-control-allow-origin'), 'https://sitio-ajeno.example');
  assert.strictEqual(propio.headers.get('access-control-allow-origin'), config.appUrl);
});

test('ruta inexistente de la API: 404 en JSON, sin detalle interno', async () => {
  const { server, base } = await levantar();
  const r = await fetch(base + '/api/nada');
  const j = await r.json();
  server.close();
  assert.strictEqual(r.status, 404);
  assert.deepStrictEqual(Object.keys(j), ['error']);
});

test('autenticación: el intento 16 desde la misma IP recibe 429', async () => {
  const { server, base } = await levantar();
  const estados = [];
  for (let i = 0; i < 16; i++) estados.push((await fetch(base + '/api/auth/login', { method: 'POST' })).status);
  server.close();
  assert.ok(estados.slice(0, 15).every((s) => s !== 429), 'no debía limitar antes del intento 16');
  assert.strictEqual(estados[15], 429);
});
