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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK = process.argv.includes('--mock') || process.env.CRUCIBLE_MOCK === '1';

const ledger = new Ledger();
const pending = new Map(); // session id → { session, threadId }

function makeProvider() {
  return MOCK ? demoProvider() : new AnthropicProvider();
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'web', 'index.html')));
      return;
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
});
