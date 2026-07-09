import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CrucibleSession } from '../src/engine.js';
import { demoProvider } from '../src/demo.js';
import { extractJson } from '../src/json.js';
import { PERSONAS } from '../src/personas.js';

test('full protocol runs end-to-end against the mock council', async () => {
  const events = [];
  const session = new CrucibleSession({
    provider: demoProvider(),
    onEvent: (e) => events.push(e),
  });

  const sharpened = await session.sharpen('I should probably make a big change soon', 80);
  assert.equal(sharpened.is_sharp, false);
  assert.ok(sharpened.sharpened_claim.length > 10);

  const findings = await session.convene();
  assert.equal(findings.length, PERSONAS.length);
  for (const f of findings) {
    assert.ok(f.persona, 'finding has persona name');
    assert.ok(Array.isArray(f.attacks) && f.attacks.length >= 1);
    assert.ok(f.concession, 'every attacker concedes one strong thing');
    for (const a of f.attacks) {
      assert.ok(a.severity >= 1 && a.severity <= 5);
      assert.ok(a.question, 'every attack carries an answerable question');
    }
  }

  const crossfire = await session.crossfire();
  assert.ok(crossfire.cruxes.length >= 1 && crossfire.cruxes.length <= 3);

  const grades1 = await session.stand(['I just know the timing is right', "I'd figure something out"]);
  assert.ok(grades1.some((g) => g.verdict === 'EVADED'));
  assert.ok(grades1.filter((g) => g.verdict !== 'MET').every((g) => g.press), 'non-MET grades carry a press');

  const grades2 = await session.stand(
    ['Two competitors launched in the last quarter', 'My cofounder can cover ops; trigger is a missed payroll'],
    { round: 2 },
  );
  assert.ok(grades2.some((g) => g.verdict === 'MET'), 'a real answer earns MET on the second round');

  const verdict = await session.verdict();
  assert.ok(verdict.recommended_confidence >= 0 && verdict.recommended_confidence <= 100);
  assert.ok(
    verdict.recommended_confidence < 80,
    'evasion is evidence: recommended confidence pays for the dodged crux',
  );
  assert.ok(verdict.kill_criteria.length >= 1, 'kill criteria are mandatory');
  assert.ok(verdict.reexamine_after_days > 0);

  const phases = events.filter((e) => e.type === 'phase').map((e) => e.phase);
  assert.deepEqual(phases, ['SHARPEN', 'COUNCIL', 'CROSSFIRE', 'THE_STAND', 'THE_STAND', 'VERDICT']);
});

test('prior history is put in front of the council', async () => {
  const provider = demoProvider();
  const history = [
    {
      startedAt: '2026-06-01T00:00:00.000Z',
      claim: 'the same big claim',
      sharpened: { sharpened_claim: 'the same big claim, sharpened' },
      statedConfidence: 90,
      verdict: { recommended_confidence: 40, closing: 'Come back with evidence.' },
    },
  ];
  const session = new CrucibleSession({ provider, history });
  await session.sharpen('the same big claim', 90);
  await session.convene();

  const councilCalls = provider.calls.filter((c) => c.system.includes('PERSONA:'));
  assert.equal(councilCalls.length, PERSONAS.length);
  for (const call of councilCalls) {
    assert.ok(call.user.includes('PRIOR RECORD'), 'council brief includes the prior record');
    assert.ok(call.user.includes('recommended 40'));
  }
});

test('extractJson survives fences, prose, and bare objects', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Here you go:\n```json\n{"a": 1}\n```\nHope that helps!'), { a: 1 });
  assert.deepEqual(extractJson('Verdict follows. {"a": {"b": [1,2]}} That is all.'), { a: { b: [1, 2] } });
  assert.throws(() => extractJson('no json here at all'));
});
