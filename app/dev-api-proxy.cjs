const http = require('node:http');

// Expo's existing tunnel carries authenticated API requests as well as the app bundle.
module.exports = function devApiProxy(middleware) {
  return (req, res, next) => {
    const prefix = '/pawsafe-api/';
    if (!req.url?.startsWith(prefix)) return middleware(req, res, next);
    const upstream = http.request({
      hostname: '127.0.0.1', port: 8080, path: req.url.slice(prefix.length - 1),
      method: req.method, headers: { ...req.headers, host: '127.0.0.1:8080' }, timeout: 180000,
    }, response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'The PawSafe API is unavailable. Start the cloud API on port 8080.' }));
    });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
  };
};
