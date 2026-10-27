// Puente entre la app de Claude (conector MCP) y el Apps Script del asistente (mcp.gs).
// La app de Claude no sigue la redirección que hace Google, así que este servidor hace el pedido por ella.
// URL del conector: https://<este-servidor>/mcp/<TOKEN>  (el TOKEN es el del asistente; acá no se guarda nada).
const http = require('http');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const DESTINO = process.env.ASISTENTE_URL;

// Voz de Jarvis: Florian, la misma del canal de YouTube (proyecto-youtube/comun/hacer_video.py).
const VOZ = 'de-DE-FlorianMultilingualNeural', PROSODIA = { rate: '+10%', pitch: '+4Hz' };
const validos = new Set();
async function tokenValido(k) {
  if (validos.has(k)) return true;
  const r = await fetch(DESTINO + '?asistente=1&mcp=' + k, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  const ok = /"result"/.test(await r.text());
  if (ok) validos.add(k);
  return ok;
}
const escapar = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function sintetizar(texto) {
  const voz = new MsEdgeTTS();
  await voz.setMetadata(VOZ, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = voz.toStream(escapar(texto), PROSODIA);
  const partes = [];
  for await (const c of audioStream) partes.push(c);
  voz.close();
  return Buffer.concat(partes);
}
// GET /tts/<TOKEN>?t=texto → el mp3 va saliendo a medida que se genera (el navegador empieza a sonar enseguida).
async function tts(res, k, texto) {
  texto = texto.slice(0, 1500);
  if (!texto.trim()) return res.writeHead(400).end();
  const voz = new MsEdgeTTS();
  const [ok] = await Promise.all([tokenValido(k), voz.setMetadata(VOZ, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)]);
  if (!ok) { voz.close(); return res.writeHead(403).end(); }
  const { audioStream } = voz.toStream(escapar(texto), PROSODIA);
  res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  audioStream.on('end', () => voz.close());
  audioStream.on('error', () => { voz.close(); res.destroy(); });
  audioStream.pipe(res);
}

http.createServer(async (req, res) => {
  const t = req.url.match(/^\/tts\/([a-f0-9]{16,64})\?t=(.*)$/);
  if (t && req.method === 'GET') {
    let texto = '';
    try { texto = decodeURIComponent(t[2].replace(/\+/g, ' ')); } catch (e) { return res.writeHead(400).end(); }
    return tts(res, t[1], texto).catch(e => { if (!res.headersSent) res.writeHead(502).end(e.message); else res.destroy(); });
  }
  const m = req.url.match(/^\/mcp\/([a-f0-9]{16,64})\/?(\?.*)?$/);
  if (req.url === '/') return res.writeHead(200).end('ok');
  if (!m) return res.writeHead(404).end();
  if (req.method === 'GET') return res.writeHead(405, { Allow: 'POST' }).end(); // sin stream de eventos
  if (req.method === 'DELETE') return res.writeHead(200).end();
  if (req.method !== 'POST') return res.writeHead(405).end();
  let body = '';
  for await (const c of req) body += c;
  let id = null;
  try { id = JSON.parse(body).id ?? null; } catch (e) {}
  try {
    const r = await fetch(DESTINO + '?asistente=1&mcp=' + m[1], { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body });
    const txt = (await r.text()).trim();
    if (!txt) return res.writeHead(202).end(); // notificación: sin respuesta
    if (txt[0] !== '{' && txt[0] !== '[') throw new Error('respuesta rara del Apps Script');
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(txt);
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } }));
  }
}).listen(process.env.PORT || 8080);
module.exports = { sintetizar };
