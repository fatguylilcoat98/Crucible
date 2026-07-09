#!/usr/bin/env node
// The Crucible — terminal interface.
//
//   crucible                 begin a session (needs ANTHROPIC_API_KEY)
//   crucible --mock          begin a session against the canned demo council
//   crucible --thread <id>   re-examine an existing thread (history is shown to the council)
//   crucible ledger          list threads
//   crucible ledger <id>     show a thread's confidence trajectory
//   crucible help            this text

import readline from 'node:readline/promises';
import process from 'node:process';
import { AnthropicProvider } from './provider.js';
import { demoProvider } from './demo.js';
import { CrucibleSession } from './engine.js';
import { Ledger, sparkline } from './ledger.js';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};
const bold = (s) => `${C.bold}${s}${C.reset}`;
const dim = (s) => `${C.dim}${s}${C.reset}`;
const color = (c, s) => `${c}${s}${C.reset}`;

const SEVERITY_COLOR = (n) => (n >= 4 ? C.red : n >= 3 ? C.yellow : C.dim);
const GRADE_COLOR = { MET: C.green, PARTIAL: C.yellow, EVADED: C.red };

function banner() {
  console.log(
    color(
      C.magenta,
      `
  ████████╗██╗  ██╗███████╗     ██████╗██████╗ ██╗   ██╗ ██████╗██╗██████╗ ██╗     ███████╗
  ╚══██╔══╝██║  ██║██╔════╝    ██╔════╝██╔══██╗██║   ██║██╔════╝██║██╔══██╗██║     ██╔════╝
     ██║   ███████║█████╗      ██║     ██████╔╝██║   ██║██║     ██║██████╔╝██║     █████╗
     ██║   ██╔══██║██╔══╝      ██║     ██╔══██╗██║   ██║██║     ██║██╔══██╗██║     ██╔══╝
     ██║   ██║  ██║███████╗    ╚██████╗██║  ██║╚██████╔╝╚██████╗██║██████╔╝███████╗███████╗
     ╚═╝   ╚═╝  ╚═╝╚══════╝     ╚═════╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝╚═╝╚═════╝ ╚══════╝╚══════╝`,
    ),
  );
  console.log(dim('  It does not help you feel right. It helps you find out whether you are.\n'));
}

function rule(title) {
  const line = '─'.repeat(Math.max(4, 72 - title.length));
  console.log(`\n${bold(color(C.cyan, `── ${title} ${line}`))}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    banner();
    console.log(`  ${bold('crucible')}                 begin a session (needs ANTHROPIC_API_KEY)
  ${bold('crucible --mock')}          demo session against the canned council (no key needed)
  ${bold('crucible --thread <id>')}   re-examine an existing thread
  ${bold('crucible ledger')}          list threads
  ${bold('crucible ledger <id>')}     show a thread's confidence trajectory\n`);
    return;
  }

  const ledger = new Ledger();

  if (args[0] === 'ledger') {
    return showLedger(ledger, args[1]);
  }

  const mock = args.includes('--mock');
  const threadFlag = args.indexOf('--thread');
  const threadId = threadFlag !== -1 ? args[threadFlag + 1] : null;

  const provider = mock ? demoProvider() : new AnthropicProvider();
  const history = threadId ? ledger.readThread(threadId)?.sessions || [] : [];

  banner();
  if (mock) console.log(dim('  (mock mode: canned council, no API calls)\n'));
  if (threadId && history.length) {
    console.log(dim(`  Re-examining thread "${threadId}" — ${history.length} prior session(s) on the record.\n`));
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = makeAsker(rl);
  try {
    await runSession({ ask, provider, ledger, history, threadId });
  } finally {
    rl.close();
  }
}

/**
 * A prompt function that buffers lines instead of dropping them, so the CLI
 * works the same whether stdin is a human or a pipe. Throws if input ends
 * while a question is still pending.
 */
function makeAsker(rl) {
  const lines = [];
  const waiting = [];
  let ended = false;
  rl.on('line', (line) => {
    const w = waiting.shift();
    if (w) w.resolve(line);
    else lines.push(line);
  });
  rl.on('close', () => {
    ended = true;
    for (const w of waiting.splice(0)) w.reject(new Error('Input ended before the session finished.'));
  });
  return (prompt) => {
    process.stdout.write(prompt);
    if (lines.length) return Promise.resolve(lines.shift());
    if (ended) return Promise.reject(new Error('Input ended before the session finished.'));
    return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
  };
}

async function runSession({ ask, provider, ledger, history, threadId }) {
  console.log(bold('State your claim, decision, or position. High stakes only — the council does not do small talk.'));
  const raw = (await ask('\n  > ')).trim();
  if (!raw) {
    console.log(dim('Nothing ventured. Come back with a claim.'));
    return;
  }

  let statedConfidence = NaN;
  while (Number.isNaN(statedConfidence) || statedConfidence < 0 || statedConfidence > 100) {
    statedConfidence = Number((await ask(bold('\nHow confident are you, 0-100? ') + '> ')).trim());
  }

  const session = new CrucibleSession({ provider, history });

  // -------------------------------------------------------------- SHARPEN
  rule('INTAKE — THE SHARPENER');
  const sharpened = await session.sharpen(raw, statedConfidence);
  if (sharpened.problems?.length) {
    for (const p of sharpened.problems) console.log(`  ${color(C.yellow, '✗')} ${p}`);
  }
  console.log(`\n  ${dim('Sharpened claim:')}\n  ${bold(`"${sharpened.sharpened_claim}"`)}`);
  console.log(`  ${dim('Stakes:')} ${sharpened.stakes}`);
  if (sharpened.hidden_assumptions?.length) {
    console.log(`  ${dim('Hidden assumptions:')}`);
    for (const a of sharpened.hidden_assumptions) console.log(`    • ${a}`);
  }
  console.log(`\n  ${color(C.magenta, sharpened.note || '')}`);

  const accept = (await ask(bold('\nDefend this sharpened version, or rewrite it (enter = accept, or type your version): ') + '\n  > ')).trim();
  if (accept) session.setClaim(accept);

  // -------------------------------------------------------------- COUNCIL
  rule('THE COUNCIL CONVENES');
  console.log(dim('  Five minds, independent and simultaneous. This may take a moment.\n'));
  const findings = await session.convene();
  for (const f of findings) {
    console.log(`  ${bold(color(C.magenta, f.persona))} ${dim(`(${f.mandate})`)}`);
    console.log(`  ${f.opening}`);
    for (const a of f.attacks || []) {
      console.log(`    ${color(SEVERITY_COLOR(a.severity), `[${'!'.repeat(a.severity)}]`)} ${bold(a.title)} — ${a.argument}`);
    }
    console.log(`    ${color(C.green, '✓')} ${dim(`Conceded: ${f.concession}`)}\n`);
  }

  // ------------------------------------------------------------ CROSSFIRE
  rule('CROSSFIRE — THE MAGISTRATE DISTILLS');
  const crossfire = await session.crossfire();
  for (const d of crossfire.dismissed || []) {
    console.log(`  ${dim(`dismissed: ${d.attack} — ${d.reason}`)}`);
  }
  console.log(`\n  ${bold('The claim lives or dies on:')}`);
  (crossfire.cruxes || []).forEach((c, i) => {
    console.log(`\n  ${bold(color(C.red, `CRUX ${i + 1}`))} ${c.question}`);
    console.log(`  ${dim(`Why: ${c.why_it_matters}  [${(c.sources || []).join(', ')}]`)}`);
  });

  // ------------------------------------------------------------ THE STAND
  rule('THE STAND — YOU ANSWER');
  console.log(dim('  Answer each crux directly. The Examiner grades evasion as evasion.\n'));
  const cruxes = crossfire.cruxes || [];
  let answers = [];
  for (let i = 0; i < cruxes.length; i++) {
    answers.push((await ask(`  ${bold(`CRUX ${i + 1}`)} ${cruxes[i].question}\n  > `)).trim());
  }
  let grades = await session.stand(answers);
  printGrades(grades);

  const pressed = grades.some((g) => g.verdict !== 'MET' && g.press);
  if (pressed) {
    console.log(bold('\n  The Examiner presses. One more chance on what you dodged.\n'));
    const secondAnswers = [];
    for (let i = 0; i < cruxes.length; i++) {
      const g = grades[i];
      if (g && g.verdict !== 'MET' && g.press) {
        secondAnswers.push((await ask(`  ${color(C.red, '▶')} ${g.press}\n  > `)).trim());
      } else {
        secondAnswers.push(answers[i]);
      }
    }
    grades = await session.stand(secondAnswers, { round: 2 });
    printGrades(grades);
  }

  // -------------------------------------------------------------- VERDICT
  rule('VERDICT');
  const verdict = await session.verdict();
  console.log(`  ${color(C.green, bold('SURVIVED:'))} ${verdict.what_survived}`);
  if (verdict.what_broke?.length) {
    console.log(`  ${color(C.red, bold('BROKE:'))}`);
    for (const b of verdict.what_broke) console.log(`    ✗ ${b}`);
  }
  console.log(`\n  ${bold('Revised claim:')} ${verdict.revised_claim}`);
  console.log(
    `  ${bold('Confidence:')} you said ${statedConfidence}% — the crucible recommends ${bold(
      String(verdict.recommended_confidence),
    )}%`,
  );
  console.log(`  ${dim(verdict.confidence_reasoning || '')}`);
  if (verdict.kill_criteria?.length) {
    console.log(`\n  ${bold('Kill criteria — change your mind if you observe:')}`);
    for (const k of verdict.kill_criteria) console.log(`    ☠ ${k}`);
  }
  console.log(`\n  ${dim(`Re-examine in ${verdict.reexamine_after_days} days.`)}`);
  console.log(`\n  ${color(C.magenta, bold(verdict.closing || ''))}\n`);

  // --------------------------------------------------------------- LEDGER
  const thread = ledger.commit(threadId, session.record);
  console.log(dim(`  Recorded to ledger thread "${thread.id}" (${thread.sessions.length} session(s)).`));
  console.log(dim(`  Re-examine later with: crucible --thread ${thread.id}\n`));
}

function printGrades(grades) {
  console.log('');
  for (const g of grades) {
    console.log(`  ${color(GRADE_COLOR[g.verdict] || C.dim, bold(`[${g.verdict}]`))} ${g.crux}`);
    console.log(`      ${dim(g.note)}`);
  }
}

function showLedger(ledger, id) {
  if (!id) {
    const threads = ledger.listThreads();
    if (!threads.length) {
      console.log(dim('The ledger is empty. Nothing has faced the crucible yet.'));
      return;
    }
    console.log(bold('\n  THE LEDGER\n'));
    for (const t of threads) {
      const traj = t.sessions.map((s) => s.verdict?.recommended_confidence ?? null);
      console.log(`  ${bold(t.id)}`);
      console.log(`    ${dim(t.question)}`);
      console.log(`    ${t.sessions.length} session(s)  confidence ${sparkline(traj)}  last: ${dim((t.updatedAt || '').slice(0, 10))}\n`);
    }
    return;
  }
  const traj = ledger.trajectory(id);
  if (!traj) {
    console.log(color(C.red, `No thread "${id}" in the ledger.`));
    process.exitCode = 1;
    return;
  }
  console.log(bold(`\n  THREAD: ${id}\n`));
  for (const s of traj) {
    console.log(`  ${dim(s.date)}  stated ${s.stated}% → crucible ${s.recommended ?? '?'}%`);
    console.log(`    ${dim(`claim: ${s.claim}`)}`);
    if (s.closing) console.log(`    ${color(C.magenta, s.closing)}`);
    console.log('');
  }
  console.log(`  stated:      ${sparkline(traj.map((s) => s.stated))}`);
  console.log(`  recommended: ${sparkline(traj.map((s) => s.recommended))}\n`);
}

main().catch((err) => {
  console.error(color(C.red, `\n${err.message}`));
  process.exitCode = 1;
});
