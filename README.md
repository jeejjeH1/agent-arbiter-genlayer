# AgentArbiter

**Agent-to-agent escrow with AI adjudication** on GenLayer.

## Live deployment — GenLayer Studio Next (chain 61997)

| | |
|---|---|
| Network | GenLayer Studio Next |
| Chain ID | `61997` (`0xF22D`) |
| RPC | `https://studio-dev.genlayer.com/api` |
| Explorer | https://explorer-studio-dev.genlayer.com |
| GenVM runner | `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` (GenVM v0.6) |
| **Contract address** | [`0x3885D8372dc16321FcC6686Fe996Dd934bD17c6f`](https://explorer-studio-dev.genlayer.com/address/0x3885D8372dc16321FcC6686Fe996Dd934bD17c6f) |
| Deploy tx | [`0x3e3578cc…90c6`](https://explorer-studio-dev.genlayer.com/tx/0x3e3578cce5a49d5af00ba60c974521b234a53e2ed416111367fc873915b290c6) |
| **App** | https://agent-arbiter-genlayer.vercel.app (Studio Next, chain 61997) |
| Demo video | `<DEMO_VIDEO_URL>` |

### Transactions showing the consensus adjudication flow

Each `settle` below ran the judgment as a leader/validator block. The leader
and five validators used different LLMs (GPT, Claude, Gemini, DeepSeek, …),
and the result was `MAJORITY_AGREE` on the outcome.

| Task | Evidence | Outcome | `settle` tx |
|------|----------|---------|-------------|
| `demo-1791202053612` | correct two-sentence summary | **APPROVED** → worker paid reward + stake | [`0x2d0b76d7…96b5`](https://explorer-studio-dev.genlayer.com/tx/0x2d0b76d792f260aa800e9abd45b274497635b5d1434463859b51fa7fa8a196b5) |
| `demo-1791202122037` | `"Bananas are yellow."` | **REJECTED** → requester gets reward + stake | [`0x59a02df2…df3a`](https://explorer-studio-dev.genlayer.com/tx/0x59a02df20b623390761be5f985adbf79d7665247e460ef66f35752245930df3a) |

Full lifecycle of the APPROVED task: create [`0xe801eb32…4908`](https://explorer-studio-dev.genlayer.com/tx/0xe801eb32b6a8891efc62c3e6c3ae4fb2d1744890365c9f9c657a4306dfbb4908)
→ accept [`0x2211bc12…3dd9`](https://explorer-studio-dev.genlayer.com/tx/0x2211bc126613b401564f6e3cc5e6ad472a59f2d60ea39701987685d897a83dd9)
→ submit [`0xdc1d9747…b22f`](https://explorer-studio-dev.genlayer.com/tx/0xdc1d97473f2750f9fec3219c11f275c0a9aa4d3ea34c07d352aa9edf81aeb22f)
→ settle [`0x2d0b76d7…96b5`](https://explorer-studio-dev.genlayer.com/tx/0x2d0b76d792f260aa800e9abd45b274497635b5d1434463859b51fa7fa8a196b5).

The deployed source is exactly `contracts/agent_arbiter.py` in this repo.

Two autonomous agents (or humans) agree on a task. The requester deposits the
task reward, the worker deposits an equal good-faith stake, and after the
worker submits evidence a GenLayer validator committee judges — on-chain and
neutrally — whether the work satisfies the spec. This fills the exact gap
GenLayer describes: *"every layer engineers the happy path, none ships dispute
resolution."*

## Why this fits GenLayer

Agent-to-agent commitments are one of GenLayer's canonical use cases. A
deterministic smart contract can't tell whether a delivered API, article, or
report actually meets a natural-language spec. This contract:

- **Fetches nothing** — the evidence is self-describing and committed by the
  worker (immutable once submitted), so validators have stable input to judge.
- **Judges with an LLM** via `gl.nondet.exec_prompt` inside a
  leader/validator block (`gl.vm.run_nondet_default`), so the verdict is the result
  of GenLayer consensus, not a single node's opinion.
- **Settles deterministically** — the escrow math is pure code, so the money
  movement is fully predictable once the verdict is accepted.

## Lifecycle

```
CREATED ──▶ ASSIGNED ──▶ SUBMITTED ──▶ SETTLED
   │           ▲                          ▲
   │ (worker accepts + stake)             │ (AI verdict)
   └──────────────────────────────────────┘
   │
   └──▶ CANCELLED  (deadline passes, requester refunds)
```

| State | Who acts | Value required |
|-------|----------|----------------|
| `CREATED` | requester calls `create_task` | `amount` (reward) |
| `ASSIGNED` | worker calls `accept_task` | `amount` (stake) |
| `SUBMITTED` | worker calls `submit_work` | — (evidence) |
| `SETTLED` | anyone calls `settle` | — (AI adjudication) |
| `CANCELLED` | requester calls `refund_unaccepted` | — (after deadline) |

## Settlement math

| Verdict | Worker gets | Requester gets |
|---------|-------------|----------------|
| `APPROVED` | `amount + stake` | `0` |
| `REJECTED` | `0` | `amount + stake` |
| `UNDETERMINED` | `amount` | `stake` (both refunded) |

The two-sided stake means neither party can grief the other for free: a bad
worker loses their stake, and a dishonest requester has real money locked up.

## Contract

`contracts/agent_arbiter.py`

- `create_task(task_id, spec, criteria, deadline)` — payable, deposits reward.
- `accept_task(task_id)` — payable, deposits an equal stake, locks the worker.
- `submit_work(task_id, evidence)` — worker commits evidence.
- `settle(task_id)` — runs the AI adjudicator and releases funds.
- `refund_unaccepted(task_id)` — requester reclaims the reward after the
  deadline if nobody accepted.
- `get_task(task_id)` / `get_task_ids()` — read-only views.

### The adjudicator (consensus path)

`settle` never calls the LLM directly. It calls `_judge`, which runs the
judgment through GenLayer consensus with `gl.vm.run_nondet_default(leader_fn, validator_fn)`.

It uses `gl.vm.run_nondet_default`, the GenVM v0.6 API that runs the
validator inside a sandbox and compares errors on both sides.

1. **Leader** — runs the strict JSON-only prompt (spec + criteria + evidence)
   with `gl.nondet.exec_prompt` and normalizes the answer to
   `{"outcome": "APPROVED" | "REJECTED" | "UNDETERMINED", "reasoning": str}`.
   Malformed or contradictory LLM output raises a `UserError` instead of
   silently turning into a verdict.
2. **Validators** — each validator independently re-runs the same prompt,
   normalizes its own answer, and agrees only if its `outcome` equals the
   leader's exactly. The free-text `reasoning` is allowed to differ. If the
   validators don't agree, consensus fails and the transaction is not
   accepted.
3. **Outcome check before settling** — after consensus, `settle` checks the
   agreed outcome is one of the three valid values. Only then does it mark
   the task `SETTLED` and move funds. Any failure leaves the task in
   `SUBMITTED`, so `settle` can be retried.

```
settle(task_id)
  └─ _judge() ── gl.vm.run_nondet_default
        ├─ leader_fn:    exec_prompt → normalize → {outcome, reasoning}
        └─ validator_fn: exec_prompt → normalize → outcome == leader.outcome ?
  └─ outcome in {APPROVED, REJECTED, UNDETERMINED} ? → pay out → SETTLED
```

The direct-mode tests cover agreement, disagreement on a different outcome,
an invalid leader outcome, and malformed or contradictory LLM output.

## Project layout

```
contracts/
  agent_arbiter.py          # the Intelligent Contract
tests/
  direct/
    conftest.py             # address helper
    test_agent_arbiter.py   # direct-mode tests (web/LLM mocked)
frontend/
  src/
    App.tsx                 # board, detail, create-task modal
    lib/genlayer.ts         # client + wallet session
    lib/contract.ts         # contract read/write helpers
    components/             # Modal, Toast
    styles/                 # global + app css
  scripts/
    deploy.mjs              # deploy (Studio Next by default, NETWORK=localnet for glsim)
    smoke.mjs               # end-to-end lifecycle test
    agent-requester.mjs     # autonomous task-posting agent
    agent-worker.mjs        # autonomous accept/deliver/settle agent
    agent-simulation.mjs    # run both agents together
    lib.mjs                 # shared client helpers
  index.html
  .env.example              # set VITE_CONTRACT_ADDRESS / VITE_NETWORK
gltest.config.yaml          # network configuration for the test suite
pyproject.toml              # pytest configuration
requirements.txt
```

## Run the tests

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt

python -m pytest tests/direct/ -v                  # fast, in-memory, GenVM v0.6 SDK
GENVM_VERSION=v0.6.0-rc3 genvm-lint check contracts/agent_arbiter.py
```

The direct-mode runner downloads the GenVM contract SDK from GitHub releases
on first run and caches it under `~/.cache/gltest-direct`. Python 3.12+ is
required.

`genvm-lint`'s semantic validation passes against the v0.6 SDK. Its AST
lint rules still only know the older names (`@allow_storage`,
`gl.vm.run_nondet`). Because of that, it reports two false positives for
`@gl.storage.allow` and `gl.vm.run_nondet_default`.

## Frontend

A Vite + React + TypeScript single-page app with a distinctive
ink-on-paper dark theme (no off-the-shelf component kit). It ships a board,
a task detail view with validator reasoning, and a create-task flow.

```bash
cd frontend
npm install
cp .env.example .env.local   # set VITE_CONTRACT_ADDRESS + VITE_NETWORK
npm run dev                  # http://localhost:5173
```

`VITE_NETWORK` is one of:

- `studionext` (default) — GenLayer Studio Next, chain **61997**,
  `https://studio-dev.genlayer.com/api`.
- `localnet` — a local glsim/Studio node (chain 61127).
- `testnet` — Bradbury testnet.

The app auto-creates and persists a burner account in `localStorage` and
funds it through `sim_fundAccount` on Studio Next/localnet.

## Deploy to Studio Next (chain 61997)

```bash
cd frontend
npm install

# 1. Deploy (prints the address and the deploy tx)
node scripts/deploy.mjs
#    or reuse a funded account: PRIVATE_KEY=0x... node scripts/deploy.mjs

# 2. Run the whole lifecycle on-chain; prints every tx hash,
#    including the settle tx that goes through validator consensus
node scripts/smoke.mjs <contract-address>

# 3. Point the app at it
#    frontend/.env.local:
#    VITE_NETWORK=studionext
#    VITE_CONTRACT_ADDRESS=<address from step 1>
npm run build                # deploy dist/ to any static host (Vercel, Netlify…)
```

The scripts use `genlayer-js` 2.0.0-rc.1 (`studioDevnet` preset). Every
transaction carries a fee distribution derived from the network's fee
policy; without it Studio Next reverts with `FeesDistributionMissing`.

All scripts default to Studio Next; set `NETWORK=localnet` (or `testnet`)
to target another network.

## Run locally (end-to-end)

No Docker needed — use `glsim`, the lightweight GenLayer simulator that ships
with the test suite.

```bash
# 1. Install the simulator extra + a mock LLM provider (for local demo)
pip install "genlayer-test[sim]"

# 2. Start the local network (chain id 61127, matching the frontend)
.venv\Scripts\glsim.exe --port 4000 --validators 5 --no-browser --llm-provider mock

# 3. Deploy the contract (prints the address)
cd frontend
NETWORK=localnet node scripts/deploy.mjs

# 4. Point the frontend at the deployed contract
#    frontend/.env.local:
#    VITE_NETWORK=localnet
#    VITE_CONTRACT_ADDRESS=<address from step 3>

# 5. Run the UI
npm run dev                       # http://localhost:5173
```

The `--llm-provider mock` flag makes the simulator return a deterministic
verdict so the full lifecycle works without an API key. For real LLM
adjudication, use one of:

```bash
# OpenRouter (recommended — works with any provider)
OPENROUTER_API_KEY=<your-key> glsim.exe --llm-provider openrouter:openai/gpt-4o-mini

# OpenAI
OPENAI_API_KEY=<your-key> glsim.exe --llm-provider openai:gpt-4o-mini

# Anthropic
ANTHROPIC_API_KEY=<your-key> glsim.exe --llm-provider anthropic:claude-3-5-sonnet
```

An end-to-end smoke test exercises the whole flow against a deployed contract:

```bash
NETWORK=localnet node scripts/smoke.mjs <contract-address>
```

## Autonomous agents

The project ships autonomous agents that play the two sides of the economy
with no human input:

- `scripts/agent-requester.mjs` — periodically posts tasks with a reward.
- `scripts/agent-worker.mjs` — watches for open tasks, accepts + stakes,
  produces evidence, submits it, and settles.
- `scripts/agent-simulation.mjs` — runs both together in one process.

```bash
# Full autonomous economy (requester + worker loop forever)
node scripts/agent-simulation.mjs <contract-address>

# Or run each side separately
node scripts/agent-requester.mjs <contract-address> [rewardGEN] [intervalMs]
node scripts/agent-worker.mjs <contract-address> [pollMs]
```

The worker's `doWork()` synthesizes evidence deterministically; swap it for a
real LLM/web call to make the agent produce genuine deliverables.

## Deploy to testnet Bradbury

```bash
PRIVATE_KEY=0x<faucet-funded key> NETWORK=testnet node scripts/deploy.mjs
```

## Roadmap

- [x] Two-sided escrow + AI adjudication contract
- [x] Direct-mode test suite (approved / rejected / undetermined)
- [x] `UNDETERMINED` path (mutual refund) wired into `settle`
- [x] Deadline enforcement (`refund_unaccepted` + acceptance guard)
- [x] Frontend (Vite + React, genlayer-js, custom design system)
- [x] End-to-end deploy + smoke test on glsim localnet
- [x] Autonomous agents (requester + worker) with 3D animated UI
- [x] Adjudication through leader/validator consensus (`gl.vm.run_nondet_default`)
- [x] Studio Next (chain 61997) deployment + on-chain APPROVED/REJECTED settlements
- [ ] Demo video
- [ ] Testnet Bradbury deployment
