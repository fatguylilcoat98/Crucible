// The Crucible — local web interface.
//
//   node src/server.js           (needs ANTHROPIC_API_KEY)
//   node src/server.js --mock    canned council, no key needed
//
// The engine streams protocol events as newline-delimited JSON. A session
// pauses at THE STAND; the browser posts the claimant's answers to resume.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { AnthropicProvider } from './provider.js';
import { demoProvider } from './demo.js';
import { CrucibleSession } from './engine.js';
import { Ledger } from './ledger.js';
import { storeApiKey, clearApiKey, loadApiKey } from './secrets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK = process.argv.includes('--mock') || process.env.CRUCIBLE_MOCK === '1';

const ledger = new Ledger();
const pending = new Map(); // session id → { session, threadId }

/**
 * The key entered through Settings (encrypted at rest with the access key)
 * wins over the ANTHROPIC_API_KEY environment variable.
 */
function resolveApiKey() {
  if (config.accessKey) {
    const stored = loadApiKey(config.accessKey);
    if (stored.key) return { key: stored.key, source: 'settings', status: stored.status };
    if (stored.status === 'unreadable') {
      return { key: config.apiKey || null, source: config.apiKey ? 'env' : null, status: 'unreadable' };
    }
  }
  return { key: config.apiKey || null, source: config.apiKey ? 'env' : null, status: 'unset' };
}

function makeProvider() {
  return MOCK ? demoProvider() : new AnthropicProvider({ apiKey: resolveApiKey().key });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function ndjsonStream(res) {
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' });
  return (event) => res.write(JSON.stringify(event) + '\n');
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function authorized(req) {
  if (!config.accessKey) return true;
  const offered = String(req.headers['x-crucible-key'] || '');
  const expected = config.accessKey;
  const a = crypto.createHash('sha256').update(offered).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, mock: MOCK });
    }

    if (url.pathname.startsWith('/api/') && !authorized(req)) {
      return sendJson(res, 401, { error: 'access key required' });
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'web', 'index.html')));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/settings') {
      const resolved = resolveApiKey();
      return sendJson(res, 200, {
        canStore: Boolean(config.accessKey),
        keySource: resolved.key ? resolved.source : null, // 'settings' | 'env' | null
        keyStatus: resolved.status, // 'stored' | 'unset' | 'unreadable'
        model: config.model,
        mock: MOCK,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/settings') {
      if (!config.accessKey) {
        return sendJson(res, 400, {
          error: 'CRUCIBLE_ACCESS_KEY must be set first — the stored API key is encrypted with it.',
        });
      }
      const { apiKey } = JSON.parse(await readBody(req));
      // Forgive the classic paste accidents: whitespace and wrapping quotes.
      const cleaned = String(apiKey || '').trim().replace(/^["']+|["']+$/g, '');
      if (!cleaned) {
        clearApiKey();
        return sendJson(res, 200, { cleared: true });
      }
      if (!cleaned.startsWith('sk-ant-')) {
        return sendJson(res, 400, {
          error: 'That does not look like an Anthropic API key — they start with sk-ant- (from console.anthropic.com → API Keys).',
        });
      }
      if (!MOCK) {
        // Prove the key works before storing it: one minimal live call.
        try {
          await new AnthropicProvider({ apiKey: cleaned }).complete({ system: 'ping', user: 'ping', maxTokens: 1 });
        } catch (err) {
          if (String(err.message).includes('API 401')) {
            return sendJson(res, 400, { error: 'Anthropic refused this key (401) — check it in console.anthropic.com.' });
          }
          return sendJson(res, 502, { error: `Could not verify the key against the Anthropic API: ${err.message}` });
        }
      }
      storeApiKey(cleaned, config.accessKey);
      return sendJson(res, 200, { saved: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/ledger') {
      return sendJson(res, 200, {
        threads: ledger.listThreads().map((t) => ({
          id: t.id,
          question: t.question,
          sessions: t.sessions.length,
          updatedAt: t.updatedAt,
          trajectory: t.sessions.map((s) => ({
            stated: s.statedConfidence,
            recommended: s.verdict?.recommended_confidence ?? null,
          })),
        })),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/start') {
      const { claim, confidence, threadId } = JSON.parse(await readBody(req));
      if (!claim || typeof confidence !== 'number') {
        return sendJson(res, 400, { error: 'claim (string) and confidence (number) are required' });
      }
      const emit = ndjsonStream(res);
      const history = threadId ? ledger.readThread(threadId)?.sessions || [] : [];
      const session = new CrucibleSession({ provider: makeProvider(), history, onEvent: emit });
      const id = crypto.randomUUID();
      pending.set(id, { session, threadId: threadId || null });

      await session.sharpen(claim, confidence);
      await session.convene();
      const crossfire = await session.crossfire();
      emit({ type: 'await_defense', sessionId: id, cruxes: crossfire.cruxes || [] });
      res.end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/defend') {
      const { sessionId, answers } = JSON.parse(await readBody(req));
      const entry = pending.get(sessionId);
      if (!entry) return sendJson(res, 404, { error: 'unknown or expired session' });

      const emit = ndjsonStream(res);
      const { session, threadId } = entry;
      session.onEvent = emit;

      const round = session.record.stand.length + 1;
      const grades = await session.stand(answers, { round });
      const presses = grades.map((g) => (g.verdict !== 'MET' ? g.press : null));
      if (presses.some(Boolean) && session.record.stand.length < 2) {
        emit({ type: 'await_press', sessionId, presses });
        res.end();
        return;
      }

      const verdict = await session.verdict();
      const thread = ledger.commit(threadId, session.record);
      pending.delete(sessionId);
      emit({ type: 'committed', threadId: thread.id, sessions: thread.sessions.length, verdict });
      res.end();
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    if (res.headersSent) {
      res.write(JSON.stringify({ type: 'error', message: err.message }) + '\n');
      res.end();
    } else {
      sendJson(res, 500, { error: err.message });
    }
  }
});

server.listen(config.port, () => {
  console.log(`The Crucible is lit: http://localhost:${config.port}${MOCK ? '  (mock council)' : ''}`);
  if (!config.accessKey) {
    console.log('No CRUCIBLE_ACCESS_KEY set — the API is open. Fine on localhost, not on a server.');
  }
});
