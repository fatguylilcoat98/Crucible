// The Ledger — the memory of The Crucible. Every question you bring is a
// thread; every session on that thread is a record of what you claimed, what
// confidence you held, what broke, and what the crucible recommended. Over
// time the ledger shows whether your thinking on a question is actually
// improving or just circling.

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export class Ledger {
  constructor(dir = config.ledgerDir) {
    this.dir = dir;
  }

  ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  threadPath(id) {
    return path.join(this.dir, `${id}.json`);
  }

  /** Turn a claim into a stable, filesystem-safe thread id. */
  static slugify(text) {
    return (
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'untitled'
    );
  }

  listThreads() {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.readThread(f.replace(/\.json$/, '')))
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  readThread(id) {
    const p = this.threadPath(id);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  }

  /** Append a finished session record to a thread, creating it if needed. */
  commit(threadId, sessionRecord) {
    this.ensureDir();
    const id = threadId || Ledger.slugify(sessionRecord.sharpened?.sharpened_claim || sessionRecord.claim);
    const existing = this.readThread(id) || {
      id,
      question: sessionRecord.sharpened?.sharpened_claim || sessionRecord.claim,
      createdAt: new Date().toISOString(),
      sessions: [],
    };
    existing.sessions.push(sessionRecord);
    existing.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.threadPath(id), JSON.stringify(existing, null, 2));
    return existing;
  }

  /**
   * The trajectory of a thread: for each session, stated vs recommended
   * confidence — the raw material for seeing whether a mind is moving.
   */
  trajectory(id) {
    const thread = this.readThread(id);
    if (!thread) return null;
    return thread.sessions.map((s) => ({
      date: (s.startedAt || '').slice(0, 10),
      claim: s.sharpened?.sharpened_claim || s.claim,
      stated: s.statedConfidence,
      recommended: s.verdict?.recommended_confidence ?? null,
      closing: s.verdict?.closing || null,
    }));
  }
}

/** Tiny ASCII sparkline for confidence values 0-100. */
export function sparkline(values) {
  const glyphs = '▁▂▃▄▅▆▇█';
  return values
    .map((v) => (v == null ? '·' : glyphs[Math.min(glyphs.length - 1, Math.floor((v / 100) * glyphs.length))]))
    .join('');
}
