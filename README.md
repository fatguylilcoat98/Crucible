# The Crucible

**An adversarial AI environment for high-stakes thinking.**

Most AI is optimized to be helpful and agreeable. That is exactly the wrong
property when you are trying to think through something difficult, important,
or expensive to get wrong. Agreeable AI makes you lazy: you accept shallow
answers, you never pressure-test your own reasoning, and you walk away more
confident and no more correct.

The Crucible is built to be the opposite. It is not a chat. It is a protocol:

> a room full of extremely sharp, slightly combative minds who actually give a
> damn about getting to the truth — not about making you feel good.

## The protocol

Every session moves through fixed phases. There are no shortcuts and no
"sounds great, good luck!" exits.

**1. Intake — the Sharpener.**
Nothing vague gets in. "I should probably grow the business" is a mood, not a
claim. The Sharpener names every vagueness problem bluntly, surfaces the hidden
assumptions your claim quietly depends on, and forces it into a testable
shape. You state a confidence number (0–100) and you are held to it.

**2. The Council.**
Five adversarial minds attack your claim *independently and in parallel* —
independence is what makes their agreement meaningful:

| Member | Mandate |
|---|---|
| **The Skeptic** | Evidence and epistemics — the gap between what you believe and what you actually know |
| **The Adversary** | Failure modes — assumes your plan is adopted and acts as the force that breaks it |
| **The Economist** | Costs, incentives, opportunity cost, second-order effects |
| **The Steelman** | The strongest honest case *against* you — the opponent you haven't rehearsed dismissing |
| **The Historian** | The outside view — the reference class of people who tried this, and what happened to them |

Every attack must be concrete and answerable, carries an earned severity
(1–5), and every attacker must concede exactly one genuinely strong thing
about your claim — an attacker who concedes nothing is not credible.

**3. Crossfire — the Magistrate distills.**
The attacks are weighed against each other. Weak ones are dismissed *on the
record, with reasons*. What remains is distilled into 1–3 **cruxes**: the
questions your claim actually lives or dies on.

**4. The Stand.**
This is the part no other tool makes you do: **you answer.** The Examiner
grades each answer — `MET`, `PARTIAL`, or `EVADED` — and grades the answer you
gave, not the one you wish you'd given. Restating your conviction is graded as
evasion. Anything dodged gets pressed exactly once more.

**5. The Verdict.**
The Magistrate synthesizes the whole record: what survived (the Crucible is
adversarial, not nihilistic — "this held up" is a permitted and important
verdict), what broke, a revised claim, a recommended confidence with the delta
from yours justified, and **mandatory kill criteria** — the observable evidence
that should change your mind. A position you would never abandon under any
evidence is a belief, not a judgment. Evasion on the stand is evidence, and
the recommended confidence pays for it.

**6. The Ledger.**
Every session is committed to a thread. Bring the same question back next
month and the council is shown your prior record — your old claim, your old
confidence, and what the crucible said last time. If your claim hasn't changed
and your evidence hasn't improved, they will say so. `crucible ledger` shows
each thread's confidence trajectory over time: stated vs. recommended, so you
can see whether your thinking on a question is actually moving or just
circling.

## Running it

Requires Node 20+. No dependencies to install.

```bash
export ANTHROPIC_API_KEY=sk-ant-...

node src/cli.js                # a full session in the terminal
node src/cli.js --mock         # demo session against a canned council (no key)
node src/cli.js ledger         # list threads
node src/cli.js ledger <id>    # a thread's confidence trajectory
node src/cli.js --thread <id>  # re-examine a question; history goes to the council

node src/server.js             # web interface at http://localhost:4517
node src/server.js --mock      # web interface, canned council

npm test                       # offline test suite (mock council)
```

Configuration (all optional): `CRUCIBLE_MODEL` (default `claude-sonnet-5`),
`CRUCIBLE_LEDGER_DIR` (default `./crucible-ledger`), `CRUCIBLE_PORT` or `PORT`
(default `4517`), `CRUCIBLE_MAX_TOKENS`, `CRUCIBLE_ACCESS_KEY` (see below).

## Deploying to a server

**Never expose the server without `CRUCIBLE_ACCESS_KEY`.** The API spends your
Anthropic credits and the ledger is your private thinking. When the key is
set, every `/api/*` request must carry it in the `x-crucible-key` header; the
web UI asks for it once and keeps it in localStorage. `GET /health` is the
unauthenticated health check.

**The Anthropic API key can be entered in the web UI** (Settings tab) instead
of the environment: it is verified against the Anthropic API with a minimal
live call, then stored encrypted with a key derived from your access key
(scrypt → AES-256-GCM) in `_settings.json` on the data volume — nothing
readable at rest, and the passphrase lives only in the server environment.
A key saved in Settings takes precedence over `ANTHROPIC_API_KEY`. If you
change `CRUCIBLE_ACCESS_KEY`, the stored key becomes unreadable and Settings
will ask for it again.

**Home server (Docker):**

```bash
git clone <this repo> && cd Crucible
cp .env.example .env      # set ANTHROPIC_API_KEY and CRUCIBLE_ACCESS_KEY
docker compose up -d --build
curl http://localhost:4517/health   # → {"ok":true,...}
```

The ledger lives on the `crucible-data` volume so it survives restarts and
rebuilds. Expose the service through your Cloudflare Tunnel (map a hostname to
`http://localhost:4517`) or reverse proxy for TLS — do not port-forward it
raw. Back up the volume; the ledger is the whole point of the system.

**Bare Node, no Docker:**

```bash
ANTHROPIC_API_KEY=sk-ant-... \
CRUCIBLE_ACCESS_KEY=$(openssl rand -hex 24) \
CRUCIBLE_LEDGER_DIR=/var/lib/crucible \
PORT=4517 node src/server.js
```

**Render** (`render.yaml` blueprint, kept for transition): New → Blueprint,
point it at this repo, set both secrets when prompted. Uses the starter plan
with a persistent disk at `/data`; on the free plan delete the `disk:` block
and accept that the ledger resets on each deploy.

## Design principles

- **Agreeableness is a bug here.** Every prompt in `src/personas.js` bans
  flattery, hedging, and unanswerable gotchas. Attacks must be specific enough
  to respond to — "have you considered risks?" is banned by contract.
- **Independence before synthesis.** Council members do not see each other's
  work in the first pass. Convergence between independent attackers is signal;
  a single synthesizing model faking five voices is not.
- **You must take the stand.** The core failure mode of thinking with AI is
  passivity. The protocol structurally cannot finish without your answers, and
  the grade for a dodge is written into the permanent record.
- **Calibration over vibes.** Confidence numbers in, confidence numbers out,
  kill criteria always, re-examination scheduled. The ledger keeps score.
- **The verdict serves your future self,** not your present comfort.

## Layout

```
src/
  personas.js   the council, the Sharpener, the Magistrate, the Examiner (the heart of the product)
  engine.js     the protocol state machine (interface-agnostic, event-driven)
  provider.js   Anthropic API over fetch + offline mock provider
  ledger.js     persistent decision journal with confidence trajectories
  cli.js        terminal interface
  server.js     local web server (NDJSON streaming)
  web/          single-file web interface
test/           offline suite against the mock council
```
