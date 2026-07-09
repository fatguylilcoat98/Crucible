// The Crucible protocol. A session moves through fixed phases:
//
//   SHARPEN     — the claim is forced into a testable shape
//   COUNCIL     — five adversarial minds attack it independently, in parallel
//   CROSSFIRE   — the Magistrate distills the attacks into 1-3 cruxes
//   THE STAND   — the claimant answers the cruxes; the Examiner grades the
//                 answers and presses once on anything dodged
//   VERDICT     — the Magistrate synthesizes: what survived, what broke,
//                 revised claim, recommended confidence, kill criteria
//
// The engine is interface-agnostic: it emits events through `onEvent` and
// pauses at THE STAND until the caller supplies answers, so the same engine
// drives the CLI, the web UI, and the tests.

import {
  PERSONAS,
  SHARPENER_SYSTEM,
  MAGISTRATE_CROSSFIRE_SYSTEM,
  EXAMINER_SYSTEM,
  MAGISTRATE_VERDICT_SYSTEM,
} from './personas.js';
import { extractJson } from './json.js';

export class CrucibleSession {
  /**
   * @param {object} opts
   * @param {{complete(req): Promise<string>}} opts.provider
   * @param {(event: object) => void} [opts.onEvent]
   * @param {Array<object>} [opts.history] prior sessions on this thread, for continuity
   */
  constructor({ provider, onEvent = () => {}, history = [] }) {
    this.provider = provider;
    this.onEvent = onEvent;
    this.history = history;
    this.record = {
      startedAt: new Date().toISOString(),
      claim: null,
      sharpened: null,
      statedConfidence: null,
      findings: [],
      crossfire: null,
      stand: [],
      verdict: null,
    };
  }

  emit(type, data) {
    this.onEvent({ type, ...data });
  }

  historyContext() {
    if (this.history.length === 0) return '';
    const lines = this.history.map((s) => {
      const v = s.verdict || {};
      return `- ${s.startedAt.slice(0, 10)}: claim "${s.sharpened?.sharpened_claim || s.claim}" | stated confidence ${s.statedConfidence} | crucible recommended ${v.recommended_confidence ?? '?'} | verdict: ${v.closing || 'n/a'}`;
    });
    return `\n\nPRIOR RECORD — this claimant has faced The Crucible on this question before. Hold them to their own history: if the claim has not changed but the evidence has not improved, say so.\n${lines.join('\n')}`;
  }

  // ------------------------------------------------------------------ SHARPEN
  async sharpen(rawClaim, statedConfidence) {
    this.record.claim = rawClaim;
    this.record.statedConfidence = statedConfidence;
    this.emit('phase', { phase: 'SHARPEN' });

    const text = await this.provider.complete({
      system: SHARPENER_SYSTEM,
      user: `The claimant states (with ${statedConfidence}% confidence):\n\n"${rawClaim}"${this.historyContext()}`,
    });
    const sharpened = extractJson(text);
    this.record.sharpened = sharpened;
    this.emit('sharpened', { sharpened });
    return sharpened;
  }

  /** The claimant may accept the sharpened claim or supply their own wording. */
  setClaim(finalClaim) {
    this.record.sharpened = { ...this.record.sharpened, sharpened_claim: finalClaim };
  }

  get activeClaim() {
    return this.record.sharpened?.sharpened_claim || this.record.claim;
  }

  // ------------------------------------------------------------------ COUNCIL
  async convene() {
    this.emit('phase', { phase: 'COUNCIL' });
    const brief = this.councilBrief();

    const findings = await Promise.all(
      PERSONAS.map(async (persona) => {
        const text = await this.provider.complete({ system: persona.system, user: brief });
        const finding = { persona: persona.name, personaId: persona.id, mandate: persona.mandate, ...extractJson(text) };
        this.emit('finding', { finding });
        return finding;
      }),
    );
    this.record.findings = findings;
    return findings;
  }

  councilBrief() {
    const s = this.record.sharpened || {};
    return [
      `CLAIM UNDER EXAMINATION: "${this.activeClaim}"`,
      `STAKES: ${s.stakes || 'not stated'}`,
      `CLAIMANT'S STATED CONFIDENCE: ${this.record.statedConfidence}%`,
      s.hidden_assumptions?.length
        ? `ASSUMPTIONS SURFACED AT INTAKE:\n${s.hidden_assumptions.map((a) => `- ${a}`).join('\n')}`
        : '',
      this.historyContext(),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  // ---------------------------------------------------------------- CROSSFIRE
  async crossfire() {
    this.emit('phase', { phase: 'CROSSFIRE' });
    const dossier = this.record.findings
      .map(
        (f) =>
          `${f.persona} (${f.mandate}) — ${f.opening}\n` +
          (f.attacks || [])
            .map((a) => `  [severity ${a.severity}] ${a.title}: ${a.argument}\n    Question: ${a.question}`)
            .join('\n') +
          `\n  Concession: ${f.concession}`,
      )
      .join('\n\n');

    const text = await this.provider.complete({
      system: MAGISTRATE_CROSSFIRE_SYSTEM,
      user: `${this.councilBrief()}\n\nTHE COUNCIL'S INDEPENDENT FINDINGS:\n\n${dossier}`,
    });
    const crossfire = extractJson(text);
    this.record.crossfire = crossfire;
    this.emit('crossfire', { crossfire });
    return crossfire;
  }

  // ---------------------------------------------------------------- THE STAND
  /**
   * Grade the claimant's answers to the cruxes. `answers` is an array aligned
   * with `record.crossfire.cruxes`. Returns the Examiner's grades; callers
   * should offer the claimant one chance to respond to any `press` and then
   * call this again with `round: 2` before moving to the verdict.
   */
  async stand(answers, { round = 1 } = {}) {
    this.emit('phase', { phase: 'THE_STAND', round });
    const cruxes = this.record.crossfire?.cruxes || [];
    const paired = cruxes.map((crux, i) => ({ crux, answer: answers[i] ?? '(no answer given)' }));

    const text = await this.provider.complete({
      system: EXAMINER_SYSTEM,
      user:
        `CLAIM: "${this.activeClaim}"\n\n` +
        paired
          .map((p, i) => `CRUX ${i + 1}: ${p.crux.question}\nCLAIMANT'S ANSWER: ${p.answer}`)
          .join('\n\n') +
        (round > 1 ? '\n\nThis is the claimant\'s SECOND attempt after being pressed. Grade accordingly.' : ''),
    });
    const graded = extractJson(text);
    const entry = { round, answers, grades: graded.grades || [] };
    this.record.stand.push(entry);
    this.emit('grades', { round, grades: entry.grades });
    return entry.grades;
  }

  // ------------------------------------------------------------------ VERDICT
  async verdict() {
    this.emit('phase', { phase: 'VERDICT' });
    const standRecord = this.record.stand
      .map(
        (entry) =>
          `ROUND ${entry.round}:\n` +
          entry.grades
            .map((g, i) => `  Crux: ${g.crux}\n  Answer: ${entry.answers[i] ?? ''}\n  Grade: ${g.verdict} — ${g.note}`)
            .join('\n'),
      )
      .join('\n\n');

    const text = await this.provider.complete({
      system: MAGISTRATE_VERDICT_SYSTEM,
      user:
        `${this.councilBrief()}\n\n` +
        `CRUXES FROM CROSSFIRE:\n${(this.record.crossfire?.cruxes || [])
          .map((c) => `- ${c.question} (${c.why_it_matters})`)
          .join('\n')}\n\n` +
        `CROSS-EXAMINATION RECORD:\n${standRecord || '(the claimant declined to take the stand)'}`,
      maxTokens: 3000,
    });
    const verdict = extractJson(text);
    this.record.verdict = verdict;
    this.record.finishedAt = new Date().toISOString();
    this.emit('verdict', { verdict });
    return verdict;
  }
}
