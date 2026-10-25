/**
 * GitHub push webhook -> redeploy listener.
 *
 * Previously this skipped signature verification entirely when WEBHOOK_SECRET was unset
 * (`if (!SECRET) return true`), and the listener is reachable from the internet, so any
 * anonymous POST to /webhook ran `git pull && npm install && npm run build && pm2 restart`.
 * Verification now fails closed: with no secret the process refuses to start at all.
 */
import 'dotenv/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { execSync } from 'child_process';
import http from 'http';

const PORT = Number(process.env.WEBHOOK_PORT || 9000);
const SECRET = (process.env.WEBHOOK_SECRET || '').trim();
const REPO_DIR = process.env.REPO_DIR || '/opt/streamvault';
const BRANCH = process.env.DEPLOY_BRANCH || 'main';

// Validate rather than coerce: `Number('1mb')` is NaN, which would make every
// `size > MAX_BODY_BYTES` comparison false and leave the body unbounded.
const MAX_BODY_BYTES = (() => {
  const parsed = Number.parseInt(String(process.env.WEBHOOK_MAX_BYTES ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1024 * 1024;
})();

if (!SECRET) {
  console.error(
    '[webhook] FATAL: WEBHOOK_SECRET is not set. Refusing to run, because an unverified\n' +
      'webhook lets anyone who can reach this port trigger a deploy. Set it to the same\n' +
      'value you configured in the GitHub webhook (Settings -> Webhooks), then restart.',
  );
  process.exit(1);
}

const log = (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void => {
  const out = level === 'info' ? console.log : console.error;
  out(JSON.stringify({ t: new Date().toISOString(), level, message, ...(meta ?? {}) }));
};

/** Constant-time comparison of the `sha256=` HMAC GitHub sends in X-Hub-Signature-256. */
function verifySignature(payload: string, signature: string): boolean {
  if (!signature) return false;
  const expected = 'sha256=' + createHmac('sha256', SECRET).update(payload).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

let deploying = false;

function deploy(): void {
  if (deploying) {
    log('warn', 'Deploy already in progress, skipping');
    return;
  }
  deploying = true;
  log('info', 'Deploy started', { repoDir: REPO_DIR });
  const started = Date.now();
  try {
    execSync('git pull', { cwd: REPO_DIR, stdio: 'inherit' });
    execSync('cd backend && npm install && npm run build', { cwd: REPO_DIR, stdio: 'inherit' });
    execSync('cd frontend && npm install && npm run build', { cwd: REPO_DIR, stdio: 'inherit' });
    execSync('cd backend && pm2 restart streamvault', { cwd: REPO_DIR, stdio: 'inherit' });
    log('info', 'Deploy complete', { ms: Date.now() - started });
  } catch (err) {
    log('error', 'Deploy failed', { err: err instanceof Error ? err.message : String(err) });
  } finally {
    deploying = false;
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  let aborted = false;

  req.on('data', (chunk: Buffer) => {
    if (aborted) return;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      aborted = true;
      log('warn', 'Webhook body over limit, refusing', { limit: MAX_BODY_BYTES });
      res.writeHead(413);
      res.end('Payload too large');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (aborted) return;
    const body = Buffer.concat(chunks).toString('utf8');
    const signature = String(req.headers['x-hub-signature-256'] || '');

    if (!verifySignature(body, signature)) {
      log('warn', 'Rejected webhook with invalid signature', { ip: req.socket.remoteAddress });
      res.writeHead(403);
      res.end('Invalid signature');
      return;
    }

    // GitHub sends a ping on webhook creation; acknowledge it without deploying.
    if (String(req.headers['x-github-event'] || '') === 'ping') {
      res.writeHead(200);
      res.end('pong');
      return;
    }

    let payload: { ref?: string } = {};
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end('Bad payload');
      return;
    }

    if (payload.ref !== `refs/heads/${BRANCH}`) {
      res.writeHead(200);
      res.end(`Ignored (not ${BRANCH})`);
      return;
    }

    res.writeHead(202);
    res.end('Deploying');
    deploy();
  });

  req.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(400);
      res.end('Bad request');
    }
  });
});

server.listen(PORT, () => {
  log('info', 'Webhook listener running', { port: PORT, branch: BRANCH, repoDir: REPO_DIR });
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    log('info', `Received ${signal}, closing webhook listener`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
