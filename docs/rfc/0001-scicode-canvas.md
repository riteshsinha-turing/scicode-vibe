# RFC 0001 — SciCode Canvas on Central Task Platform

| Field      | Value                                              |
| ---------- | -------------------------------------------------- |
| Status     | Draft                                              |
| Author(s)  | Vivek Vashistha                                    |
| Created    | 2026-06-17                                         |
| Updated    | 2026-06-18                                         |
| Reviewers  | TBD (CTP team, SciCode pod leads, QC pipeline owners) |
| Supersedes | —                                                  |

## TL;DR

Replace the current multi-tool SciCode workflow (Labeling Tool + Colab + Chrome Validator + RLHF playground + Google Sheets + QC Gatekeeper) with a single trainer experience built on the **Central Task Platform (CTP)** plus a new **SciCode Canvas** (Workbench guest pane).

- **CTP** owns batches, claim/submit, reviews, rework, delivery, deterministic gates, audit, and the QC pipeline integration.
- **SciCode Canvas** owns the SciCode-specific UX: notebook render + sync with Colab, Validator (golden-vs-tests), pass@k orchestration UI, per-sample review, metadata, single submit. No API keys, no sandbox, no LLM calls.
- **Task creation pipeline** (`Scicode-Trainers-chotu`) stays external; its output `.ipynb` files are seeded into CTP as a batch.
- **Model execution for pass@k** is host-mediated through CTP (no model API keys in the canvas).
- **Task granularity**: one CTP task = one SciCode datapoint = one paper = `main + 2-4 sub-problems` as a single unit. Sub-problems are execution units **inside** a task, not standalone CTP tasks (see §10 alt #5).
- **New service** `scicode-eval` is the execution backend for Validator + pass@k. qc-bridge dispatches to it; canvas never touches it directly (see §6.7).

The first delivery target is end-to-end happy path: pipeline → seed → claim → edit → validator → pass@k → submit → L1/L2 review → delivery. Earnings, A/B, and per-variant routing are out of scope for v1.

## 1. Background

### 1.1 Where SciCode lives today

The current SciCode delivery workflow spans many platforms:

- **Task creation pipeline** (`Scicode-Trainers-chotu`) — fetches arXiv/OpenAlex papers, runs a 3-stage LLM pipeline, outputs `.ipynb` notebooks with draft sub-problems and tests.
- **SFT project** (`scicode-second-batch-phase-2`, project ID 170) on Labeling Tool — trainer claims and finishes the task.
- **RLHF project** (`scicode-rework-v2-RLHF`, project ID 163) — separate project where 8 GPT-5.4 instances (A–H) generate model responses for pass@8. **Naming caveat:** despite the project name, this is *not* preference labeling. It's empirical pass@8 scoring of model-generated code against unit tests. No reward model, no human preference scores. See §2.2 non-goal #4.
- **Google Colab** — actual notebook editing happens here; trainers paste Colab URL into a sheet.
- **Chrome Validator plugin** (Oracle check) — runs golden solution against unit tests.
- **Pass Rate Evaluator Colab** — computes pass@8 from RLHF responses.
- **QC Gatekeeper (Gemini App)** — manual scientific-correctness, well-posedness, test-discriminativeness check.
- **Google Sheets** — task tracker, master sheet, pass rates, issue logs.
- **scicode-qc-unified-pipeline** — Tier 1 deterministic + Tier 2 LLM judge run separately on delivery batches.
- **L1 / L2 reviewers + PodLead** — manual review across the above tools.

### 1.2 Problems

From the workflow optimisation doc and the trainer guide:

1. Manual movement of tasks between systems.
2. Duplicate effort updating metadata in Sheets and Labeling Tool.
3. Limited visibility into trainer actions and review history.
4. Inconsistent pass@k tracking across main and sub-problems.
5. Manual rework follow-up.
6. Tasks moving forward with incomplete metadata.
7. Delays between PodLead approval and delivery.
8. Loose linkage between payment, quality, and approved output.

### 1.3 Why CTP

CTP already provides project, batch, task pool, claim, draft, submit, review, rework, deterministic gates, Prism/QC bridge, delivery batches, AGI-OS mirror, audit, and a Workbench guest SDK with a documented host/guest protocol. SciCode is a natural fourth canvas (alongside GDPVal, Shopify Address Validation, and the deferred TerminalBench).

## 2. Goals and non-goals

### 2.1 Goals (v1)

1. Single trainer surface for SciCode (no Labeling Tool + Colab + Sheets context-switching).
2. Authoritative submit payload with notebook ref, validator result, pass@k result, metadata.
3. CTP-mediated pass@k execution (no model API keys in canvas).
4. CTP-mediated Validator (golden-vs-tests) execution.
5. SciCode-specific deterministic gates (taxonomy, pass@k bands, metadata completeness).
6. L1 / L2 review using SciCode rubrics inside CTP admin / reviewer apps.
7. Tier 1 + Tier 2 QC pipeline wired as a CTP post-submit hook or batch-release job.
8. Notebook lives on both Colab and CTP media; Sync button keeps them aligned.

### 2.2 Non-goals (v1)

1. Replacing the upstream task-creation pipeline (`Scicode-Trainers-chotu`) — it stays external.
2. A/B variants of the canvas (deferred per CTP M1.x).
3. Payout policy, hourly vs per-approved billing.
4. RLHF-style human preference labelling (SciCode "RLHF" is model-output evaluation, not preference).
5. Real-time collaborative editing of the notebook.
6. Replacing Colab as an editor; we render and sync, not re-implement.

## 3. Personas and scopes

| Persona       | Lives in                  | Primary actions                                                                                  |
| ------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| Pipeline ops  | External pipeline + CTP admin | Generate `.ipynb` batch, upload to CTP via Task Seed                                              |
| Admin         | CTP admin                 | Project setup, canvas binding, batch seed, workflow config, deterministic gates, delivery release |
| Trainer       | CTP annotator + Canvas    | Claim → edit notebook → run validator → run pass@k → review samples → fill metadata → submit     |
| L1 reviewer   | CTP reviewer / admin      | SciCode L1 rubric (14 dims) — formatting, model-breaking evidence, taxonomy, clarity             |
| L2 validator  | CTP reviewer / admin      | SciCode L2 rubric (7 dims) — ground-truth validity, supporting evidence, logical decomposition    |
| Pod lead      | CTP admin                 | Final approval, rework assignment, delivery readiness                                             |
| QC pipeline   | scicode-qc-unified-pipeline | Tier 1 + Tier 2 automated checks, called by CTP webhook                                           |

## 4. High-level architecture

```
                ┌─────────────────────────────────────────┐
                │   External: Scicode-Trainers-chotu      │
                │   (arXiv → spec → notebook + tests)     │
                └─────────────────┬───────────────────────┘
                                  │ batch.json + .ipynb files
                                  ▼
   ┌───────────────────────────────────────────────────────────┐
   │                    CTP (turing-central-task-platform)     │
   │                                                           │
   │   apps/admin                                              │
   │     • Task Seed (batch + tasks)                           │
   │     • Workflow config (gates, rubrics)                    │
   │     • Delivery & Quality (review queue, batches)          │
   │                                                           │
   │   apps/annotator (host)                                   │
   │     • Claim / start / draft / submit                      │
   │     • <WorkbenchHost> iframes the SciCode canvas          │
   │                                                           │
   │   services/task                                           │
   │     • State machine, deterministic gates                  │
   │     • Reviews API (L1, L2, PodLead)                       │
   │     • SciCode-specific gates: passk_band, taxonomy,       │
   │       metadata_complete, subproblem_count                 │
   │                                                           │
   │   services/qc-bridge                                      │
   │     • Dispatches scicode_validator + scicode_passk jobs   │
   │       to scicode-eval; owns job lifecycle, idempotency,   │
   │       caching, polling                                    │
   │     • Calls scicode-qc-unified-pipeline (Tier 1 / 2)      │
   │                                                           │
   │   services/media                                          │
   │     • Stores .ipynb artifacts (createArtifactBundle)      │
   └─────────────────┬─────────────────────────────────────────┘
                     │ internal RPC
                     ▼
   ┌───────────────────────────────────────────────────────────┐
   │   scicode-eval (NEW — Python/FastAPI)                     │
   │     • Parse .ipynb → spec (main + subs, goldens, tests)   │
   │     • run_validator: golden vs tests in sandbox           │
   │     • run_passk: prompt-assembly + LLM call + sandbox     │
   │       (wraps chotu's sandbox.py + execute.py)             │
   │     • Holds project-scoped model API credentials          │
   │     • Returns structured per-unit per-sample results      │
   └─────────────────┬─────────────────────────────────────────┘
                     │ verdict via qc-bridge → host
                     ▼
   ┌───────────────────────────────────────────────────────────┐
   │            SciCode Canvas (new repo)                      │
   │   • Render .ipynb (read + light edit)                     │
   │   • Sync ↔ Colab (manual button)                          │
   │   • Trigger Validator (golden vs tests) via host RPC      │
   │   • Trigger pass@k (model eval) via host RPC              │
   │   • Render per-sample model outputs                       │
   │   • Per-sample accept/reject + note (L1 dim #4 evidence)  │
   │   • Metadata: domain, subdomain, perplexity, arxiv ref    │
   │   • saveDraft + submit                                    │
   │                                                           │
   │   Never holds API keys; never runs LLMs; never runs       │
   │   sandboxes; never picks "which sample to chain"          │
   │   (prompt assembly is deterministic, server-side).        │
   └───────────────────────────────────────────────────────────┘
```

### 4.1 Trust boundary

- Canvas runs in a sandboxed iframe at a different origin and uses `@turing/workbench-guest`.
- Canvas never holds model API keys, gateway tokens, or session cookies.
- Canvas calls only host-exposed namespaces: `task`, `quality`, `media`, `telemetry`, `correlation`, `error`, `lifecycle`, `user`.
- All execution that needs credentials (pass@k, Validator sandbox, QC pipeline) happens server-side in CTP.

### 4.2 Canvas key

`canvas_key: scicode` (already referenced in CTP mocks). The canvas is bound to the SciCode project via `pane_url` at project creation.

### 4.3 Task granularity (one paper = one CTP task)

A single CTP task corresponds to one SciCode datapoint:

- one paper / `.ipynb`
- one `main_problem`
- 2–4 `sub_problems`
- one set of shared dependencies and metadata
- one trainer claim → one submit → one L1/L2 review → one delivery

Sub-problems are **execution units inside** the task, not separate CTP tasks. Splitting them into multiple CTP tasks would:

1. Break the sub-problem dependency chain (sub-N's prompt is assembled from sub-(N-1)'s golden — see §6.3.4). Independent CTP tasks have no native cross-task data dependency.
2. Splinter L1/L2 review, which evaluates the whole datapoint (e.g. L2 dim #5 "Logical decomposition" — does the set of sub-problems cover the critical steps of the main? — has no meaning if subs are graded separately).
3. Break per-paper delivery — one `.ipynb` ships to the client, not N independent code blobs.

This is a deliberate rejection of the "materialize sub-problems as CTP tasks" approach — see §10 alt #5.

## 5. End-to-end flow

```
  [Pipeline]   .ipynb + spec.json
       │
       ▼
  [Admin]      Task Seed upload   →  Batch B, Tasks T1…Tn
       │
       ▼
  [Trainer]    Claim T_i           →  task_pool_entries.state = claimed
       │
       ▼
  [Host]       Mount SciCode canvas iframe (pane_url, init payload)
       │
       ▼
  [Canvas]     workbench.task.current()  → seeded payload (notebook ref + spec)
       │
       ▼
  [Canvas]     Edit notebook  ↔  Sync with Colab  ↔  saveDraft()
       │
       ▼
  [Canvas]     Run Validator  → host RPC → qc-bridge sandbox → result
       │
       ▼
  [Canvas]     Run pass@k     → host RPC → qc-bridge model eval → results
       │
       ▼
  [Canvas]     Trainer reviews per-sample outputs, fills metadata
       │
       ▼
  [Canvas]     Self-QC checklist (Gatekeeper-equivalent fields)
       │
       ▼
  [Canvas]     workbench.task.submit(payload)
       │
       ▼
  [CTP]        Deterministic gates (taxonomy, pass@k bands, metadata, subproblems)
       │      → pass: tasks.status = submitted_pending_qc
       │      → fail: 422 with reasons (canvas re-renders)
       │
       ▼
  [CTP]        Optional Tier 1 + Tier 2 QC pipeline (post-submit hook)
       │
       ▼
  [Admin]      L1 review (14 dims) → L2 review (7 dims) → PodLead approve
       │
       ▼
  [CTP]        tasks.status = approved
       │
       ▼
  [CTP]        Delivery batch release → AGI-OS mirror → client
```

### 5.1 Mapping to CTP statuses

| Trainer/system action       | tasks.status            | task_pool_entries.state |
| --------------------------- | ----------------------- | ----------------------- |
| Seeded                      | draft                   | available               |
| Claimed                     | draft                   | claimed                 |
| First saveDraft             | draft                   | in_progress             |
| Submit accepted             | submitted_pending_qc    | submitted               |
| Tier 1/2 fail or L1 rework  | rework_required         | available (or claimed by same user) |
| L2 / PodLead approve        | approved                | —                       |
| L1 / L2 reject              | rejected                | —                       |
| Quarantine (policy)         | quarantined             | —                       |

## 6. Component design

### 6.1 Task creation pipeline (external, no change in scope)

- Lives in `Scicode-Trainers-chotu`.
- Output per task: one `.ipynb` notebook + a JSON spec file with problem id, sub-problems, draft tests, references, draft taxonomy.
- A new helper script (or pipeline post-step) transforms the output into a CTP-compatible **batch JSON** suitable for Task Seed:

```json
[
  {
    "external_id": "scicode_2026_06_17_001",
    "payload": {
      "version": 1,
      "problem_id": "...",
      "title": "...",
      "paper_ref": "https://arxiv.org/abs/...",
      "draft_taxonomy": { "domain": "Physics", "subdomain": "Quantum Mechanics" },
      "subproblems": [ { "label": "Sub-problem 1", "prompt": "...", "draft_signature": "..." } ],
      "notebook": {
        "colab_url": "https://colab.research.google.com/drive/...",
        "media_id": "media_xxx"
      },
      "source": { "pipeline_run_id": "...", "generated_at": "..." }
    }
  }
]
```

- `.ipynb` blobs are uploaded ahead of time via the CTP media service (or via Task Seed's bulk upload); the seed JSON references them by `media_id`.

### 6.2 CTP admin

No new pages required for v1. Reuses:

- **Task Setup → Task Seed** for batch upload (already supports JSON arrays).
- **Delivery & Quality → Workflow Config** for SciCode deterministic gate config and review rubric editing.
- **Delivery & Quality → Task Review Queue** for L1/L2/PodLead actions.
- **Delivery & Quality → Batches Sent** for delivery readiness.

New project-level config keys (stored in workflow config):

| Key                                          | Type     | Purpose                                                |
| -------------------------------------------- | -------- | ------------------------------------------------------ |
| `scicode.passk.k`                            | int      | Samples per (model × unit). Current ops: 8 for MS (RLHF project A–H), 3 for Meta. |
| `scicode.passk.main_band`                    | [lo, hi] | Acceptance band on the cross-model averaged main pass rate. Trainer guidelines: `[0.0, 0.34)`. Mandatory checks tab in Trainers Guide tightens to `[0.0, 0.40)` — confirm with Ajay. |
| `scicode.passk.subproblem_band`              | [lo, hi] | Acceptance band on the cross-model averaged sub-problem pass rate. Trainer guidelines: `[0.0, 1.0]`. Mandatory checks tab tightens to `(0.10, 0.75)` for operational acceptance — confirm with Ajay. |
| `scicode.passk.models`                       | string[] | Allowed models. Guideline reference set: `gpt-5.4-xhigh`, `gemini-3.1-high`. Difficulty = average pass@k across this set ("pass@6 / 2" rule from guidelines edge case). |
| `scicode.passk.gate_metric`                  | enum     | `avg_across_models` (default per guidelines) \| `min_across_models` \| `per_model_all_pass`. Decides which value the gate checks. |
| `scicode.taxonomy.allowed_domains`           | string[] | Physics, Material Science, Mathematics, Chemistry, Biology, Biochemistry, Biophysics |
| `scicode.metadata.required_fields`           | string[] | `domain`, `subdomain`, `paper_ref`, `perplexity_link`   |
| `scicode.subproblem.count_range`             | [lo, hi] | `[2, 4]`                                                |
| `scicode.qc_pipeline.enabled`                | bool     | Tier 1 + Tier 2 wired                                   |
| `scicode.qc_pipeline.client`                 | enum     | `meta` or `microsoft`                                   |

### 6.3 SciCode Canvas (new repo)

Repo skeleton modelled on `turing-ctp-canvas-shopify-address-validation-pane`:

```
scicode-canvas/
├── canvas.yaml                 # canvas registration
├── manifest.json               # declared capabilities
├── package.json
├── vite.config.ts
├── Dockerfile / Dockerfile.dev
├── .github/workflows/          # CI + Cloud Run deploy
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── sdk/
│   │   ├── workbench.ts        # connect, saveDraft, submit
│   │   ├── payload.ts          # SciCodeSubmission contract
│   │   └── host-rpc.ts         # runValidator, runPassAtK wrappers
│   ├── components/
│   │   ├── Shell.tsx
│   │   ├── NotebookPane.tsx    # render .ipynb cells
│   │   ├── ColabSyncBar.tsx    # paste URL, sync, last-synced badge
│   │   ├── ValidatorPanel.tsx  # golden vs tests UI
│   │   ├── PassKPanel.tsx      # model eval UI + per-sample review
│   │   ├── MetadataForm.tsx    # domain, subdomain, refs
│   │   ├── SelfQcChecklist.tsx # gatekeeper-equivalent checks
│   │   └── SubmitBar.tsx       # gates + submit
│   └── lib/
│       └── ipynb.ts            # parser + renderer
└── README.md
```

**Declared capabilities:** `["task", "media", "quality", "telemetry"]`.

**Build-time env:**

| Var                    | Dev                                | Prod                            |
| ---------------------- | ---------------------------------- | ------------------------------- |
| `VITE_HOST_ORIGIN`     | `http://localhost:3000`            | `https://task.atlas.turing.com` |
| `VITE_FRAME_ANCESTORS` | `http://localhost:3000 'self'`     | `https://task.atlas.turing.com 'self'` |

#### 6.3.1 Notebook pane

- Parses `.ipynb` JSON; renders code + markdown cells with read-only Python and editable markdown by default.
- v1: edits to code cells happen in Colab; canvas is read + light-edit (markdown, metadata).
- v2: in-canvas code edits with Pyodide preview (out of scope for this RFC).

#### 6.3.2 Colab sync

UI:

- "Paste Colab URL" input (auto-filled from seed).
- **Sync from Colab** button: trainer downloads `.ipynb` from Colab manually (file picker) → canvas uploads via `workbench.media.upload({ scope: 'task' })` → updates `notebook.media_id` and `notebook.last_synced_at`.
- **Open in Colab** button: external link to current `colab_url`.

v1 stays manual to avoid Google Drive OAuth scope. A future iteration can add a host-side Drive bridge.

#### 6.3.3 Validator (golden vs tests)

UI:

- "Run Validator" button.
- Per-sub-problem and main-problem rows, each showing pass/fail and stack trace.

Data flow:

```
canvas → workbench.quality.submit({
  trigger: 'guest_pre_submission',
  kind: 'scicode_validator',
  payload: { task_id, notebook_media_id }
})
   → host → qc-bridge → sandbox executes golden against tests
   → verdict { status: 'pass' | 'fail', per_test: [...] }
   → canvas renders, stores in payload.validator
```

This replaces the **Chrome Validator plugin** that trainers run today.

#### 6.3.4 pass@k (model evaluation)

UI:

- `k` shown read-only from project config (e.g. 8).
- Model set shown read-only from project config (e.g. `gpt-5.4-xhigh`, `gemini-3.1-high`).
- Per-unit (each sub-problem and main) expected pass-rate band shown inline.
- "Run pass@k" button — runs **all units × all models × k samples** in one job. No trainer choice over which sub-output to chain into main.
- Progress streamed back via long-poll.
- Per-unit results table: per-model pass rate, cross-model average, per-sample code + test outcomes.

Data flow:

```
canvas → workbench.quality.submit({
  trigger: 'guest_pre_submission',
  kind: 'scicode_passk',
  payload: { task_id, notebook_media_id }    // k + models come from project config server-side
})
   → host → qc-bridge enqueues async job → scicode-eval orchestrates
   → returns SciCodeModelEvalResult[] (per-model) + ScicodeAggregateEval (averaged)
   → canvas renders + stores in payload.model_eval / payload.model_eval_aggregate
```

##### Prompt assembly rule (deterministic, server-side)

Per `SciCode_Trainer_Guidelines.docx` "Edge Case Handling → Sub-problem dependencies":

> When sub-problem N depends on sub-problem N-1, use the **gold-standard solution code** from N-1 as the prior-step context (not a model-generated answer). This prevents error accumulation from invalidating the difficulty signal of sub-problem N.

`scicode-eval` therefore assembles prompts as:

```
sub_1 prompt = sub_1.background + sub_1.prompt + sub_1.function_signature
sub_2 prompt = sub_1.golden_solution + sub_2.background + sub_2.prompt + sub_2.function_signature
sub_N prompt = sub_1.golden + ... + sub_(N-1).golden + sub_N.background + sub_N.prompt + sub_N.function_signature
main  prompt = sub_1.golden + ... + sub_N.golden + main.background + main.prompt + main.function_signature
```

Goldens are sourced from the trainer-edited notebook spec at job time. There is **no** UX for "trainer picks which model output to chain"; there is **no** model→model chaining. This is the measurement design — the pass@k of a unit must reflect that unit's intrinsic difficulty, not compounded upstream LLM error.

Independent sub-problems are treated as `Sub-problem 1` (no prior context) per the same guidelines section. The notebook spec from `Scicode-Trainers-chotu` already encodes `sub_step.step_number`; scicode-eval honours that ordering.

##### Cross-model aggregation

For each unit, per-model pass rates are preserved **and** an averaged value is computed:

```
unit.pass_rate_avg = mean(unit.pass_rate[model] for model in project.models)
```

This is the value the deterministic gate (`scicode_passk_band_gate`) consumes by default, per the guideline "average pass@3 across Gemini 3.1 (high) and GPT 5.4 (xhigh)" and the cross-validation rule "use pass@6 divided by 2".

##### When it runs

pass@k runs on demand from the canvas, **not** on submit. Submit only validates the latest stored result against bands. Re-running with the same notebook content + project config hits the cache (see §6.6).

#### 6.3.5 Per-sample review (NOT RLHF)

After pass@k results render, the trainer browses each sample and tags it `accept` / `reject` + optional note. This is **evidence collection for L1 rubric dim #4 "Model Failure Reasons"** (was the failure due to reasoning/assumption/approach error, vs. typos/syntax which are disqualifying per the trainer guidelines):

- `accept` = failure is a substantive reasoning error → contributes to model-breaking evidence.
- `reject` = failure is mechanical (typo, syntax, missing import) → trainer flags the prompt/test for revision.

Stored in `payload.model_eval[*].samples[*].trainer_verdict` and `trainer_note`. There is **no** preference scoring, no reward model, no comparison-pair labeling. The label "RLHF" on the legacy project is historical and does not imply RLHF semantics. See §2.2 non-goal #4.

A second deterministic gate (`scicode_sample_review_complete_gate`) optionally requires every failed sample to carry a trainer verdict before submit.

#### 6.3.6 Metadata form

Fields (all required unless stated):

- `domain` — enum from project config
- `subdomain` — L1 taxonomy enum, filtered by domain
- `paper_ref` — arXiv URL
- `perplexity_link` — URL
- `dependencies[]` — library + version
- `notes` (optional)

#### 6.3.7 Self-QC checklist

Mirrors the Trainer Guide "Final Delivery-Ready Verification Steps":

- Metric alignment confirmed
- Golden notebook synced
- QC Gatekeeper protocol passed (trainer attestation)
- Pass rates within band
- Validator green

Stored as `payload.self_qc.checks[]`. Drives a deterministic gate (`scicode_self_qc_complete_gate`).

### 6.4 Submit payload contract

`src/sdk/payload.ts` (canonical shape; treat changes as wire-protocol changes):

```ts
export type SciCodeDomain =
  | 'Physics' | 'Material Science' | 'Mathematics'
  | 'Chemistry' | 'Biology' | 'Biochemistry' | 'Biophysics';

export interface SciCodeNotebookRef {
  readonly colab_url?: string;
  readonly media_id?: string;       // CTP media id of the .ipynb
  readonly last_synced_at?: string; // ISO timestamp
}

export interface SciCodeUnitTestResult {
  readonly test_id: string;
  readonly passed: boolean;
  readonly stderr?: string;
  readonly duration_ms?: number;
}

export interface SciCodeValidatorResult {
  readonly status: 'pass' | 'fail';
  readonly run_at: string;
  readonly main: { readonly tests: readonly SciCodeUnitTestResult[] };
  readonly subproblems: readonly {
    readonly label: string;
    readonly tests: readonly SciCodeUnitTestResult[];
  }[];
}

export interface SciCodeModelSample {
  readonly sample_id: string;
  readonly code: string;
  readonly tests_passed: number;
  readonly tests_total: number;
  /**
   * Trainer's failure-mode classification for L1 rubric dim #4
   * "Model Failure Reasons". NOT an RLHF preference score.
   *   accept = substantive reasoning/approach error (counts as model-breaking)
   *   reject = mechanical error (typo/syntax/import) — flag for revision
   */
  readonly trainer_verdict?: 'accept' | 'reject';
  readonly trainer_note?: string;
}

export interface SciCodeModelEvalResult {
  readonly model: 'gpt-5.4-xhigh' | 'gemini-3.1-high' | string;
  readonly k: number;
  readonly run_at: string;
  readonly main: {
    readonly pass_rate: number;
    readonly samples: readonly SciCodeModelSample[];
  };
  readonly subproblems: readonly {
    readonly label: string;
    readonly pass_rate: number;
    readonly samples: readonly SciCodeModelSample[];
  }[];
}

/**
 * Cross-model averaged view consumed by the deterministic
 * `scicode_passk_band_gate`. Computed server-side by scicode-eval;
 * canvas treats it as read-only.
 */
export interface SciCodeModelEvalAggregate {
  readonly k: number;
  readonly models: readonly string[];
  readonly metric: 'avg_across_models' | 'min_across_models' | 'per_model_all_pass';
  readonly main_pass_rate: number;
  readonly subproblem_pass_rates: readonly {
    readonly label: string;
    readonly pass_rate: number;
  }[];
}

export interface SciCodeSelfQc {
  readonly checks: readonly {
    readonly id:
      | 'metric_alignment' | 'golden_synced'
      | 'qc_gatekeeper' | 'passk_in_band' | 'validator_green';
    readonly value: boolean;
  }[];
}

export interface SciCodeMetadata {
  readonly domain: SciCodeDomain;
  readonly subdomain: string;
  readonly paper_ref: string;
  readonly perplexity_link: string;
  readonly dependencies: readonly { readonly name: string; readonly version?: string }[];
  readonly notes?: string;
}

export interface SciCodeSubmission {
  readonly version: 1;
  readonly notebook: SciCodeNotebookRef;
  readonly metadata: SciCodeMetadata;
  readonly validator?: SciCodeValidatorResult;
  readonly model_eval?: readonly SciCodeModelEvalResult[];
  readonly model_eval_aggregate?: SciCodeModelEvalAggregate;
  readonly self_qc: SciCodeSelfQc;
}
```

Drafts use the same shape; `validator`, `model_eval`, and `model_eval_aggregate` are optional during draft, required for final submit.

### 6.5 SciCode-specific deterministic gates (CTP)

Registered in `services/task/src/application/deterministic-submit-gates.ts`:

| Gate                                  | Reason code                          | Source of truth          |
| ------------------------------------- | ------------------------------------ | ------------------------ |
| `scicode_metadata_complete_gate`      | `metadata_incomplete`                | `metadata` fields        |
| `scicode_taxonomy_gate`               | `taxonomy_unknown`                   | `metadata.domain/subdomain` vs config |
| `scicode_subproblem_count_gate`       | `subproblem_count_out_of_range`      | notebook spec            |
| `scicode_validator_required_gate`     | `validator_missing` / `validator_failed` | `validator`           |
| `scicode_passk_band_gate`             | `passk_main_out_of_band` / `passk_sub_out_of_band` | `model_eval_aggregate` (cross-model averaged per `scicode.passk.gate_metric`) |
| `scicode_sample_review_complete_gate` | `failed_samples_unreviewed`          | `model_eval[*].samples[*].trainer_verdict` (only failed samples need review) |
| `scicode_self_qc_complete_gate`       | `self_qc_incomplete`                 | `self_qc.checks`         |
| `scicode_dependency_pin_gate`         | `dependency_unpinned`                | `metadata.dependencies`  |

Same fingerprint + cache pattern as existing gates. Disable path through admin workflow config.

Note that `scicode_passk_band_gate` reads `model_eval_aggregate`, not per-model `model_eval`. This implements the trainer-guideline rule that difficulty is the *average* across reference models (cross-validation: "pass@6 / 2"). Per-model rates remain in `model_eval` for L1/L2 reviewer evidence.

### 6.6 qc-bridge additions

Two new job kinds in qc-bridge. Both surface to the canvas via `workbench.quality.submit({ kind, payload })` and follow the existing `POST /v1/qc/evaluate` → poll-`GET /v1/qc/jobs/:id` lifecycle.

| Job kind            | Trigger                | Latency budget | Backend                  |
| ------------------- | ---------------------- | -------------- | ------------------------ |
| `scicode_validator` | `guest_pre_submission` | seconds        | dispatches to scicode-eval `POST /v1/validate` |
| `scicode_passk`     | `guest_pre_submission` | minutes        | dispatches to scicode-eval `POST /v1/passk` (async), canvas long-polls |

qc-bridge responsibilities:

- Idempotency on `(task_id, notebook_hash, k, model_set)` — repeat clicks of "Run pass@k" with the same notebook hit the cache, not the executor.
- Job lifecycle, retry on transient failure, DLQ on permanent failure.
- Project-scoped rate limiting (cost cap).
- Audit emission on every dispatch + verdict.
- Webhook into `scicode-qc-unified-pipeline` for Tier 1/2 post-submit (see §6.8).

qc-bridge does **not** know about prompt assembly, model SDKs, or Python sandboxes. Those are scicode-eval's job.

#### Why not reuse the existing `ops_batch` pass@N path

The existing `ops_batch` policy in `services/qc-bridge/src/domain/default-policies.ts` is Prism rubric grading of an existing submission — "given this trainer output, run N LLM graders against rubric". SciCode pass@k is the opposite pattern: "given a prompt, **generate** k code samples and run them against unit tests." Different inputs, different outputs, different backend. The protocol wire (`quality.submit` → job poll) is reused; the policy and executor are net-new.

### 6.7 scicode-eval (NEW service)

New Python/FastAPI service that owns SciCode-specific execution. Lives in its own repo (or as a peer service in CTP — TBD per Open Question §8.3).

#### Responsibilities

1. **Notebook parsing** — converts a `.ipynb` blob into a structured `SciCodeTaskSpec` with `{ main, sub_steps[], required_dependencies }`. Wraps `Scicode-Trainers-chotu/final_notebook_pipeline/notebook_spec.py`.
2. **Validator execution** — for each unit (each sub_step + main), executes its `golden_solution + tests` in an isolated venv sandbox; collects per-test pass/fail/stderr. Wraps `chotu/final_notebook_pipeline/sandbox.py` + `execute.py`.
3. **pass@k orchestration** — for each `(model, unit, sample_i)` triple, assembles the deterministic prompt (see §6.3.4 prompt-assembly rule), calls the model API, executes the resulting code against the unit's tests, records the sample.
4. **Aggregation** — computes per-model and cross-model pass rates per the configured `gate_metric` (default `avg_across_models`).
5. **Credential boundary** — holds model API keys (`OPENAI_API_KEY`, `GEMINI_API_KEY`) injected via project-scoped secret. Canvas and qc-bridge never see them.

#### HTTP contract

```
POST /v1/validate
Body:
  {
    "task_id": "string",
    "notebook_media_url": "string"   // signed URL from CTP media service
  }
Response (sync, seconds):
  SciCodeValidatorResult   // shape matches the payload contract §6.4

POST /v1/passk
Body:
  {
    "task_id": "string",
    "notebook_media_url": "string",
    "k": 8,
    "models": ["gpt-5.4-xhigh", "gemini-3.1-high"],
    "gate_metric": "avg_across_models"
  }
Response (202 Accepted):
  { "job_id": "string", "status_url": "/v1/passk/jobs/:job_id" }

GET /v1/passk/jobs/:job_id?wait_ms=N
Response:
  {
    "status": "running" | "succeeded" | "failed",
    "progress": { "units_done": int, "units_total": int, "samples_done": int, "samples_total": int },
    "result": {
      "model_eval": SciCodeModelEvalResult[],
      "model_eval_aggregate": SciCodeModelEvalAggregate
    } | null
  }
```

qc-bridge owns retry/idempotency; scicode-eval is allowed to be naive about that and just executes what it's given.

#### Sandbox isolation

Each pass@k sample executes in an ephemeral subprocess venv per `chotu/sandbox.py` semantics: fresh venv per task, packages installed from `required_dependencies`, no network, time/memory limits. v1 may run these in-process within scicode-eval's worker pool. v2 can promote each sample to a K8s Job (similar to TerminalBench's K8sJobEnvironment) for hard isolation when running untrusted model code at scale.

### 6.8 Tier 1 + Tier 2 QC pipeline integration

The existing `scicode-qc-unified-pipeline` runs as a CTP **post-submit hook** on `task.submitted`:

1. CTP qc-bridge calls a webhook with `{ task_id, notebook_media_id, payload, client }`.
2. Pipeline runs Tier 1 (`validate_json`) + Tier 2 (`scicode_qc`) and posts a verdict back via `POST /v1/internal/tasks/:taskId/qc-verdicts`.
3. Verdict maps:
   - `pass` → `tasks.status = approved` (skips L1) — only if project policy allows auto-approve. Default is to keep human L1.
   - `fail` → `tasks.status = rework_required` with reasons surfaced in canvas re-open.
   - `inconclusive` → `quarantined`.

Pipeline stays in its own repo; only the webhook integration is new.

### 6.9 L1 / L2 review rubric in CTP

Reuses CTP's per-task review modal. Two new project-scoped rubric definitions:

- **L1 Reviewer Rubric** — 14 dimensions from `SciCode_Trainer_Guidelines.docx` (Scope, Reasoning Quality, Model Breaking, Model Failure Reasons, Novelty, Library, Taxonomy, Other formatting, Clarity: Language, Clarity: Question-solution, Clarity: Terminology, Self-contained, Answer correctness, Test case coverage).
- **L2 Validator Rubric** — 7 dimensions (Answer correctness, Self-contained, Test case coverage, Supporting evidence, Logical decomposition, Consistency, Validity verdict).

Stored as workflow-config rubrics; reviewer modal renders dimension rows with Yes/No grading and total score.

## 7. Build phases

Each phase is a milestone with a thin vertical slice. Sizes are rough order of magnitude, not estimates.

### Phase 0 — Project + canvas registration (S)

- Create CTP project `scicode` (or reuse `proj-scicode` mock).
- Register canvas with `canvas_key: scicode`, declared capabilities `["task", "media", "quality", "telemetry"]`.
- Bootstrap `scicode-canvas` repo from the Shopify canvas template.
- Bind project to a placeholder pane URL.
- Smoke: claim a hand-seeded task; canvas opens; `task.current()` returns payload.

### Phase 1 — Notebook render + Sync + Draft (M)

- `NotebookPane` parses and renders `.ipynb` JSON.
- `ColabSyncBar` with paste URL + manual upload + media upload via SDK.
- `saveDraft()` wired with metadata stub.
- No validator, no pass@k, no submit gates yet.
- Smoke: trainer can claim, edit metadata, save draft, reopen and resume.

### Phase 2 — scicode-eval skeleton + Validator (M)

- Bootstrap `scicode-eval` service (FastAPI + uv); wire chotu's notebook parser + sandbox.
- `POST /v1/validate` working against a hand-crafted `.ipynb`.
- New qc-bridge job kind `scicode_validator` that dispatches to scicode-eval.
- Canvas `ValidatorPanel` with run + result rendering.
- Deterministic gate `scicode_validator_required_gate` registered (initially advisory).
- Smoke: green validator result lands in payload, fail surfaces test errors.

### Phase 3 — pass@k + cross-model aggregate + per-sample review (L)

- `scicode-eval` `POST /v1/passk` with deterministic prompt assembly (goldens chained, not model outputs).
- Model adapters for `gpt-5.4-xhigh` and `gemini-3.1-high` behind a `ModelClient` port; API keys held by scicode-eval.
- Per-model + cross-model aggregate computed; `SciCodeModelEvalAggregate` populated.
- New qc-bridge job `scicode_passk` (async; long-poll) with cache on `(notebook_hash, k, model_set)`.
- Canvas `PassKPanel` with progress, per-sample table, accept/reject toggles per §6.3.5.
- Deterministic gates `scicode_passk_band_gate` (reads aggregate) and `scicode_sample_review_complete_gate`.
- Smoke: k samples × M models × N units run, aggregate computed, gate fires on out-of-band rate.

### Phase 4 — Submit + remaining gates (M)

- All deterministic gates wired (taxonomy, subproblem count, metadata, dependency pin, self-QC).
- `task.submit(payload)` end-to-end.
- Reviewer rubric configs (L1 14 dims + L2 7 dims) seeded.
- Smoke: full happy path; rework path; reject path.

### Phase 5 — Pipeline → Task Seed (S)

- Add a "ctp-export" mode to `Scicode-Trainers-chotu` that emits CTP-compatible batch JSON.
- Helper script to bulk-upload notebooks via media service and emit seed JSON with `media_id`.
- Smoke: pipeline run produces a batch importable in CTP Task Seed without manual edit.

### Phase 6 — Tier 1 + Tier 2 QC integration (M)

- Webhook endpoint exposed by `scicode-qc-unified-pipeline`.
- qc-bridge post-submit hook configured per project.
- Verdict mapping policy decided (auto-approve vs human L1).
- Smoke: failing Tier 2 → `rework_required` with reasons visible in canvas.

### Phase 7 — Delivery release wiring (S)

- Use existing `releaseDeliveryBatch` flow.
- Confirm AGI-OS mirror events for SciCode shape.
- Smoke: approved tasks → delivery batch → AGI-OS event landed.

### Phase 8 — Hardening (M)

- Telemetry dashboards.
- Replace Sheets-driven reports with CTP reporting queries.
- Trainer onboarding doc replacement (this RFC + a short trainer-facing how-to).

## 8. Open questions

### Resolved (carried for context)

| # | Question | Resolution |
|---|----------|------------|
| R1 | pass@k orchestrator: inside qc-bridge, separate service, or reuse `scicode-qc-unified-pipeline`? | **Separate `scicode-eval` service.** Wraps chotu's parser/sandbox + adds prompt assembly + model adapters. qc-bridge dispatches; canvas never calls it directly. See §6.7. |
| R2 | Sub-problem dependency input: model outputs vs goldens? | **Goldens, always.** Deterministic, server-side prompt assembly per `SciCode_Trainer_Guidelines.docx` "Edge Case Handling". No trainer choice of which sample to chain. See §6.3.4. |
| R3 | Are sub-problems separate CTP tasks? | **No.** One CTP task = one SciCode datapoint = one paper. Sub-problems are execution units inside the task. See §4.3 and §10 alt #5. |
| R4 | Is `accept`/`reject` per sample an RLHF score? | **No.** It's L1 rubric dim #4 "Model Failure Reasons" evidence (reasoning error vs typo). No preference model, no comparison-pair labeling. See §6.3.5 and §2.2 non-goal #4. |
| R5 | Should `ops_batch` Prism path be reused for SciCode pass@k? | **No.** Different paradigm (rubric grading vs generate-then-execute). Reuses the `quality.submit` wire only. See §6.6. |

### Open

1. **Notebook editing scope in v1** — read + markdown-only, or full code edit with Pyodide? Current proposal: read + markdown-only; code edits stay in Colab. Trade-off: in-canvas edits remove Colab as a dependency but require a sandboxed Python runtime in the iframe and a new "render diff vs original" UX.
2. **Colab ↔ CTP automation** — manual upload (v1) vs Drive API bridge. Drive bridge requires OAuth scope and a host-side service account.
3. **scicode-eval deployment topology** — standalone microservice (own repo, own Cloud Run) vs a Python worker pool inside the CTP monorepo. Trade-off: standalone gives cleaner stack boundary (Python vs Node) and per-service scaling; co-located reduces deployment overhead.
4. **Cross-model gate metric** — confirm `avg_across_models` (per guidelines edge case "pass@6 / 2") is the right default vs `min_across_models` (stricter — both models must show breaking) or `per_model_all_pass`. Affects pod throughput.
5. **Pass band source of truth** — `SciCode_Trainer_Guidelines.docx` says "0–34% main, 0–100% sub". `Trainers Guide.html` Mandatory Checks tab says "0–40% main, 10–75% sub" (operational). Which is the gate? Ask Ajay.
6. **Cost cap design** — per-project budget cap for pass@k? Per-trainer daily cap? Soft warning + hard cap? At k=8 × 2 models × 4 units = 64 generations per task; at 2,100 tasks = 134,400 generations + sandbox runs. Real money.
7. **Auto-approve on Tier 2 pass** — risk of bypassing human review. Default proposal: keep human L1; let admins opt in.
8. **Per-client config** (Meta vs Microsoft) — single project with config flags, or one project per client? Single project + config is simpler; two projects gives cleaner reporting and per-client RBAC.
9. **Earnings + payment models** — out of scope for v1, but submit payload should carry enough signal (`approved`, time on task, per-unit attempt counts) for AGI-OS payout decisions later.
10. **Metadata enrichment** — domain/subdomain auto-detection from paper. Could be added as a pipeline step before seed, or as a scicode-eval `/v1/classify` helper called by canvas.
11. **Notebook artifact promotion** — should final approved `.ipynb` be promoted into a delivery bundle automatically, or composed at delivery release time?
12. **scicode-qc-unified-pipeline relationship** — Tier 1/2 already runs `delivery_eval` notebooks. Is there duplication with scicode-eval's validator path? Possible consolidation: scicode-eval `/v1/validate` becomes the canonical executor and the unified pipeline's Tier 1 calls it via the same endpoint. Defer until §6.8 webhook is wired.

## 9. Risks

| Risk                                                         | Severity | Mitigation                                                       |
| ------------------------------------------------------------ | -------- | ---------------------------------------------------------------- |
| pass@k cost (k × models × units, e.g. 8 × 2 × 4 = 64 generations per task; ~134k across 2,100 tasks) | High     | qc-bridge cache per `(notebook_hash, k, model_set)`; project budget caps; rate-limit; ops dashboard with $/task |
| Colab divergence (trainer edits in Colab without sync)       | Medium   | Last-synced badge, gated submit (require sync within N minutes)  |
| `.ipynb` rendering correctness for complex cells             | Medium   | Reuse a tested ipynb renderer; explicit fallback to "Open in Colab" |
| Trainer adoption vs the existing Colab + Sheets habit        | Medium   | Phased rollout; pod lead training; keep Colab as the primary editor |
| Tier 2 LLM cost when wired as post-submit hook               | Medium   | Trigger only on `submitted_pending_qc` after deterministic pass; daily caps |
| Sandbox security for pass@k generated code (untrusted LLM-generated Python) | High     | scicode-eval runs each sample in an ephemeral venv subprocess with no network + time/memory caps (chotu pattern). v2: promote to K8s Job per sample for hard isolation. |
| scicode-eval as new single point of failure for trainer flow | Medium   | Stateless service behind LB; multi-replica; cache hits absorb most pass@k re-runs; Validator path stays available even when model APIs degrade |
| Drift between scicode-eval's notebook parser and chotu's     | Medium   | scicode-eval imports chotu's `notebook_spec.py` as a pinned dependency rather than re-implementing |
| Privacy of arXiv pre-prints in payload                       | Low      | Standard CTP audit + media access control                        |

## 10. Alternatives considered

1. **Keep Labeling Tool + Colab + Sheets, add only a thin status mirror in CTP.** Rejected: doesn't solve the multi-tool problem; payments and visibility stay weak.
2. **Build SciCode as an embedded CTP page (no canvas iframe).** Rejected: violates the AGIOS_BOUNDARY guidance — execution surfaces should be guest panes, not first-class CTP pages.
3. **Run pass@k directly from the canvas with Anthropic/OpenAI keys (`scicode-vibe` style).** Rejected: violates the Workbench Guest capability contract; canvas must not hold model API keys.
4. **Treat SFT and RLHF as separate canvases.** Rejected: matches current pain, doesn't unify the trainer experience. Also based on a misread of "RLHF" — see §2.2 non-goal #4.
5. **Materialize each sub-problem as a separate first-class CTP task to reuse existing batch QC infrastructure.** Rejected for three concrete reasons (see §4.3):
   - Sub-problem N's prompt is constructed from sub-problem (N-1)'s **golden** code per `SciCode_Trainer_Guidelines.docx` "Edge Case Handling → Sub-problem dependencies". Independent CTP tasks have no native cross-task data dependency; we would have to invent one purely for SciCode.
   - The L1 (14 dims) and L2 (7 dims) review rubrics grade the **whole datapoint** — e.g. L2 dim #5 "Logical decomposition" asks whether the set of sub-problems covers the critical steps of the main problem. That has no meaning when sub-problems are graded independently.
   - One `.ipynb` ships to the client per task. Splitting into N CTP tasks creates a fan-in/join problem at delivery release and breaks the per-paper volume target (2,100 tasks, not 2,100 × 3).
   The existing batch QC (`ops_batch`) infrastructure is also the wrong shape: it's Prism rubric grading of a submitted artifact, not generate-then-execute against unit tests (see §6.6).
6. **Reuse `ops_batch` Prism pass@N as the pass@k orchestrator.** Rejected: different paradigm (rubric grading vs code execution). See §6.6.

## 11. References

- `scicode-vibe/docs/Optimizing - Scicode Project Over flow.docx` — workflow optimisation source.
- `scicode-vibe/docs/SciCode_Trainer_Guidelines.docx` — L1/L2 rubrics, taxonomy, difficulty thresholds.
- `scicode-vibe/docs/Trainers Guide.html` — current SFT + RLHF + Validator + QC Gatekeeper procedure.
- `turing-central-task-platform/docs/WORKBENCH_GUEST_CAPABILITIES.md` — guest SDK capability surface.
- `turing-central-task-platform/docs/workbench-host-data-flow.md` — host/guest protocol.
- `turing-central-task-platform/docs/TASK_LIFECYCLE.md` — `tasks.status` and pool state machines.
- `turing-central-task-platform/docs/AGIOS_BOUNDARY.md` — ownership matrix.
- `turing-central-task-platform/docs/DETERMINISTIC_GATES.md` — gate registry pattern.
- `turing-central-task-platform/examples/gdpval-pane/` — reference rich canvas (quality.submit + artifact bundle).
- `turing-ctp-canvas-shopify-address-validation-pane/` — reference simple canvas (form + submit).
- `SciCode/scicode-qc-unified-pipeline/` — Tier 1 + Tier 2 QC pipeline (Meta + Microsoft).
- `SciCode/Scicode-Trainers-chotu/` — task creation pipeline.

## 12. Changelog

| Date       | Change             | Author          |
| ---------- | ------------------ | --------------- |
| 2026-06-17 | Initial draft      | Vivek Vashistha |
| 2026-06-18 | Corrections after re-reading `SciCode_Trainer_Guidelines.docx` + `Trainers Guide.html` and discussion with Ashu (CTP owner): (1) introduced `scicode-eval` as a new dedicated execution service in §6.7 with HTTP contract; (2) added §4.3 "Task granularity" — one CTP task per paper, sub-problems are execution units, not tasks; (3) §6.3.4 documented deterministic prompt-assembly rule (goldens, not model outputs, chained for dependent units) + cross-model averaging per "pass@6 / 2" guideline; (4) §6.3.5 split out per-sample review and clarified it is L1 dim #4 evidence, NOT RLHF; (5) §6.4 added `SciCodeModelEvalAggregate`; (6) §6.5 added `scicode_sample_review_complete_gate` and noted `passk_band_gate` reads the aggregate; (7) §6.6 documented why `ops_batch` is not reusable; (8) §10 added alt #5 (sub-problems as separate tasks — rejected) and alt #6 (Prism reuse — rejected); (9) §8 open questions reorganized into Resolved + Open with 5 new resolutions and 4 new sharp questions for Ajay. | Vivek Vashistha |

