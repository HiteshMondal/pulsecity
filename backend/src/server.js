import express from 'express';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { cfg } from './config.js';
import { log } from './log.js';
import routes, { HttpError } from './routes.js';

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : false);
app.use(helmet({
  hsts: false, // enable again once you serve HTTPS (ALB/CloudFront/nginx + certificate)
  contentSecurityPolicy: { useDefaults: true, directives: {
    'img-src': ["'self'", 'data:', 'blob:', 'https://*.amazonaws.com'],
    'connect-src': ["'self'", 'https://*.amazonaws.com'],
    'upgrade-insecure-requests': null } } }));
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => { const t = Date.now(); res.on('finish', () => req.path !== '/api/health' && log('info', 'http', { m: req.method, p: req.path, s: res.statusCode, ms: Date.now() - t })); next(); });
app.use('/api', routes);
app.use('/api', (_q, _r, next) => next(new HttpError(404, 'Not found')));

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('*', (_q, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use((err, req, res, _next) => {
  if (err.name === 'ConditionalCheckFailedException') err = new HttpError(409, 'This incident was just updated by someone else. Refresh and try again.');
  if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Invalid request body');
  const status = err.status || 500;
  if (status >= 500) {
    log('error', 'request.failed', {
      path: req.path,
      method: req.method,
      message: err.message,
      stack: err.stack
    });
  }
  res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : err.message });
});
const server = app.listen(cfg.port, () => log('info', 'server.started', { port: cfg.port, env: cfg.env }));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10e3).unref();   // don't hang if connections stay open
});
process.on('unhandledRejection', e => { log('error', 'unhandled', { err: String(e) }); process.exit(1); }); // systemd restarts it
process.on('uncaughtException', e => { log('error', 'uncaught', { err: e.stack || String(e) }); process.exit(1); });