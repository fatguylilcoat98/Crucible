import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Ledger, sparkline } from '../src/ledger.js';

function tempLedger() {
  return new Ledger(fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-test-')));
}

function record(stated, recommended, when) {
  return {
    startedAt: when,
    claim: 'Should I bet the year on this?',
    sharpened: { sharpened_claim: 'Bet the year on this, with a dated failure condition' },
    statedConfidence: stated,
    verdict: { recommended_confidence: recommended, closing: 'noted' },
  };
}

test('commit creates a thread and appends sessions across time', () => {
  const ledger = tempLedger();
  const t1 = ledger.commit(null, record(80, 45, '2026-07-01T00:00:00.000Z'));
  assert.equal(t1.sessions.length, 1);
  assert.match(t1.id, /^bet-the-year/);

  const t2 = ledger.commit(t1.id, record(60, 55, '2026-08-01T00:00:00.000Z'));
  assert.equal(t2.sessions.length, 2);

  const traj = ledger.trajectory(t1.id);
  assert.deepEqual(
    traj.map((s) => [s.stated, s.recommended]),
    [
      [80, 45],
      [60, 55],
    ],
  );
  assert.equal(ledger.listThreads().length, 1);
});

test('trajectory of unknown thread is null', () => {
  assert.equal(tempLedger().trajectory('nope'), null);
});

test('slugify produces stable filesystem-safe ids', () => {
  assert.equal(Ledger.slugify('Should I QUIT my job?!'), 'should-i-quit-my-job');
  assert.equal(Ledger.slugify('***'), 'untitled');
  assert.ok(Ledger.slugify('x'.repeat(200)).length <= 60);
});

test('sparkline maps 0-100 and tolerates gaps', () => {
  const line = sparkline([0, 50, 100, null]);
  assert.equal(line.length, 4);
  assert.equal(line[0], '▁');
  assert.equal(line[2], '█');
  assert.equal(line[3], '·');
});
