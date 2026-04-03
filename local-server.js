// ================================================
// SERVIDOR LOCAL PARA TESTES (não é usado no Vercel)
// Para testar: node local-server.js
// ================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const handler = require('./api/index.js');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(200); return res.end(); }

  // API routes -> pass to handler
  if (pathname.startsWith('/api/')) {
    // Parse body for POST
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      await new Promise(resolve => req.on('end', resolve));
      try { req.body = JSON.parse(body); } catch (e) { req.body = {}; }
    }

    // Mock Vercel response
    const mockRes = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(data) {
        res.writeHead(this.statusCode, { ...this.headers, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      },
      end() { res.writeHead(this.statusCode, this.headers); res.end(); }
    };

    return handler(req, mockRes);
  }

  // Static files
  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath) && !pathname.includes('.')) {
    filePath = path.join(__dirname, 'public', 'index.html');
  }

  try {
    const ext = path.extname(filePath);
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  } catch (e) {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`\n🎮 Helix Cash rodando em http://localhost:${PORT}`);
  console.log(`👤 Admin: admin@helixcash.com / admin123`);
  console.log(`📂 Painel admin: http://localhost:${PORT}/admin.html\n`);
});
