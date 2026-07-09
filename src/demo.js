// Canned council for offline use: powers `--mock` demo mode and the test
// suite. Responses are keyed by markers that appear in each role's system
// prompt, so the full protocol runs end-to-end with no API key.

import { MockProvider } from './provider.js';

const j = (obj) => JSON.stringify(obj);

export function demoProvider() {
  return new MockProvider({
    'ROLE:SHARPENER': j({
      is_sharp: false,
      problems: [
        '"Soon" is not a timeframe — a claim that can always be true later can never be tested now.',
        'No stated cost: what is given up if this is chosen?',
      ],
      sharpened_claim:
        'I will commit to this course within 90 days, accepting the named costs, because the expected upside beats the best alternative.',
      stakes: 'A year of effort and the best alternative use of it.',
      hidden_assumptions: [
        'The claimant\'s current information is good enough to decide now.',
        'The best alternative has been seriously priced, not just dismissed.',
      ],
      note: 'You brought a mood; the council needs a claim. Here is the testable version — own it or fix it.',
    }),

    'PERSONA:SKEPTIC': j({
      opening: 'The confidence outruns the evidence by a wide margin.',
      attacks: [
        {
          title: 'Sample size of one',
          severity: 4,
          argument:
            'The core evidence offered is the claimant\'s own recent experience. One favorable data point selected by the person it favors is not a trend; it is an anecdote with a motive.',
          question: 'What evidence from outside your own experience supports this, and did you look for any that contradicts it?',
        },
        {
          title: 'Unfalsifiable success criteria',
          severity: 3,
          argument:
            'As stated, any outcome could be read as vindication. A claim that cannot lose is not strong — it is unmeasured.',
          question: 'What specific observable result within a fixed window would count as this having failed?',
        },
      ],
      concession: 'The claimant has at least noticed the decision is high-stakes rather than drifting into it.',
    }),

    'PERSONA:ADVERSARY': j({
      opening: 'This plan survives only if nothing pushes back, and something always pushes back.',
      attacks: [
        {
          title: 'Single point of failure',
          severity: 5,
          argument:
            'The whole plan routes through one resource — the claimant\'s own capacity. When that dips (and it will, at the worst moment), there is no named fallback, so the failure mode is total rather than partial.',
          question: 'When the critical resource fails at the worst possible moment, what is the concrete fallback — named, not gestured at?',
        },
        {
          title: 'Three miracles in one step',
          severity: 3,
          argument:
            '"And then it works" is carrying three separate unproven transitions. Each might be 60% likely; the claimant is pricing the chain as if it were one 90% step.',
          question: 'Break the plan into its individual load-bearing steps: what probability do you honestly assign each one?',
        },
      ],
      concession: 'The direction of the plan is sound even if the path is underspecified.',
    }),

    'PERSONA:ECONOMIST': j({
      opening: 'The claim prices its upside carefully and its costs not at all.',
      attacks: [
        {
          title: 'Unpriced opportunity cost',
          severity: 4,
          argument:
            'Every month spent on this is a month not spent on the best alternative, which the claimant has dismissed rather than valued. A choice beats its alternative or it is the wrong choice — and no comparison has been made.',
          question: 'What exactly is the best alternative use of this time and money, and by how much does this plan beat it?',
        },
      ],
      concession: 'The downside here is bounded — this is a survivable bet even if it is a bad one.',
    }),

    'PERSONA:STEELMAN': j({
      opening: 'The strongest opponent would not attack this plan — they would agree with its goal and choose a cheaper path to it.',
      attacks: [
        {
          title: 'The patient alternative',
          severity: 4,
          argument:
            'A well-informed opponent argues: everything the claimant wants is achievable six months later at half the risk, once one key uncertainty resolves on its own. Urgency is the weakest pillar of this claim, and the opponent simply removes it.',
          question: 'What is genuinely lost by waiting until the key uncertainty resolves — not in feelings, but in outcomes?',
        },
      ],
      concession: 'If the urgency is real, the rest of the reasoning mostly follows.',
    }),

    'PERSONA:HISTORIAN': j({
      opening: 'People in this exact position are common, and most of them were wrong in the same direction.',
      attacks: [
        {
          title: 'The reference class disagrees',
          severity: 4,
          argument:
            'The base rate for plans of this shape — high conviction, short evidence, self-set deadline — is poor, and the survivors mostly credit luck plus an early pivot, not the original plan. The claimant believes this time is different but has not said why.',
          question: 'Name what is concretely different about your situation from the reference class of people who tried this and failed.',
        },
      ],
      concession: 'The claimant is at least asking the question before committing, which most of the reference class did not.',
    }),

    'ROLE:MAGISTRATE-CROSSFIRE': j({
      cruxes: [
        {
          question:
            'What observable evidence, from outside your own experience, supports acting now rather than waiting — and what would failure look like within a fixed window?',
          why_it_matters:
            'The Skeptic, the Steelman, and the Historian all converge here: the claim lives or dies on whether the urgency is evidenced or merely felt.',
          sources: ['The Skeptic', 'The Steelman', 'The Historian'],
        },
        {
          question: 'When the single critical resource fails at the worst moment, what is the named fallback?',
          why_it_matters: 'The Adversary\'s strongest attack: without a fallback the failure mode is total, which changes the expected value of the whole plan.',
          sources: ['The Adversary'],
        },
      ],
      dismissed: [
        {
          attack: 'Three miracles in one step',
          reason: 'Real, but it is a planning refinement, not a question the claim dies on; it folds into the fallback crux.',
        },
      ],
    }),

    'ROLE:EXAMINER': (req) =>
      req.user.includes('SECOND attempt')
        ? j({
            grades: [
              {
                crux: 'Evidence for acting now',
                verdict: 'PARTIAL',
                note: 'Named one external signal this time, but still no failure condition with a date on it.',
                press: 'Give the failure condition a date. What must be true by when, or you stop?',
              },
              {
                crux: 'Named fallback',
                verdict: 'MET',
                note: 'A concrete fallback was named with a trigger condition. That is an answer.',
                press: null,
              },
            ],
          })
        : j({
            grades: [
              {
                crux: 'Evidence for acting now',
                verdict: 'EVADED',
                note: 'The answer restated conviction ("I just know the timing is right") without offering anything observable. Confidence is not evidence.',
                press: 'Not how sure you are — what you have seen. Name one piece of external evidence for acting now.',
              },
              {
                crux: 'Named fallback',
                verdict: 'PARTIAL',
                note: 'A fallback category was gestured at but nothing named. "I\'d figure something out" is a plan to plan.',
                press: 'Name the fallback: who or what, and what triggers switching to it?',
              },
            ],
          }),

    'ROLE:MAGISTRATE-VERDICT': j({
      what_survived:
        'The direction of the plan and its bounded downside held up; nobody on the council found the goal itself unsound, and the fallback named under pressure is real.',
      what_broke: [
        'The urgency: no external evidence for acting now survived cross-examination, and the claimant initially evaded rather than answered.',
        'Success criteria: the claim still has no dated failure condition, which makes it unfalsifiable as stated.',
      ],
      revised_claim:
        'Proceed, but stage the commitment: take the reversible steps now, set a dated failure condition, and defer the irreversible step until at least one external signal confirms the urgency.',
      recommended_confidence: 45,
      confidence_reasoning:
        'The claimant stated 80%. The council broke the urgency argument and the claimant\'s first answers were evasive — evasion is evidence. 45% reflects a sound goal with an unproven timeline.',
      kill_criteria: [
        'The key external signal fails to appear within the fixed window.',
        'The named fallback becomes unavailable, making the failure mode total again.',
      ],
      reexamine_after_days: 30,
      closing: 'You came in certain and left with a plan — the difference is what the crucible is for.',
    }),
  });
}
