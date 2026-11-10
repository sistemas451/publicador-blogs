// Envío de mails (invitación y recuperación). Con RESEND_API_KEY y RESEND_FROM manda por Resend;
// sin ellos queda en modo simulado: no envía nada, deja el enlace en la consola (solo en desarrollo)
// y en `bandeja` (para las pruebas). En producción sin configurar, falla con un error claro.
const { config } = require('../config');

const bandeja = []; // solo modo simulado

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function plantilla({ titulo, parrafos, boton, enlace }) {
  const ps = parrafos.map((p) => `<p style="margin:0 0 14px;color:#231F20;font-size:15px;line-height:1.5">${esc(p)}</p>`).join('');
  const b = enlace
    ? `<p style="text-align:center;margin:24px 0"><a href="${esc(enlace)}" style="background:#20759E;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;display:inline-block">${esc(boton)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#F5F6F7;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fff">
<div style="background:#004669;padding:20px 28px;color:#fff;font-size:18px;font-weight:600">Publicador de blogs · Myselec</div>
<div style="height:3px;background:#20759E"></div>
<div style="padding:28px"><h1 style="margin:0 0 16px;font-size:20px;color:#004669">${esc(titulo)}</h1>${ps}${b}
<p style="margin:20px 0 0;color:#939598;font-size:12px">Si el botón no funciona, copiá este enlace en el navegador:<br>${esc(enlace || '')}</p></div>
</div></body></html>`;
}

const modoReal = () => Boolean(config.resend.apiKey && config.resend.from);

async function enviar({ para, asunto, titulo, parrafos, boton, enlace }) {
  const html = plantilla({ titulo, parrafos, boton, enlace });
  const texto = [...parrafos, enlace ? `${boton}: ${enlace}` : ''].filter(Boolean).join('\n\n');
  if (!modoReal()) {
    if (config.isProd) throw new Error('El envío de mails no está configurado (RESEND_API_KEY y RESEND_FROM).');
    bandeja.push({ para, asunto, enlace, texto });
    if (bandeja.length > 50) bandeja.shift();
    if (process.env.NODE_TEST_CONTEXT === undefined) console.log(`[mail simulado] Para ${para} — ${asunto}\n  Enlace: ${enlace}`);
    return { simulado: true };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resend.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.resend.from, to: [para], subject: asunto, html, text: texto }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Resend respondió ${r.status}`);
  return { simulado: false };
}

module.exports = { enviar, bandeja, modoReal };
