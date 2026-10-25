// Puente entre la app de Claude (conector MCP) y el Apps Script del asistente (mcp.gs).
// La app de Claude no sigue la redirección que hace Google, así que este servidor hace el pedido por ella.
// URL del conector: https://<este-servidor>/mcp/<TOKEN>  (el TOKEN es el del asistente; acá no se guarda nada).
const http = require('http');
const DESTINO = process.env.ASISTENTE_URL;

http.createServer(async (req, res) => {
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
