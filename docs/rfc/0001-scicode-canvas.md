# RFC 0001 — SciCode Canvas on Central Task Platform

| Field      | Value                                              |
| ---------- | -------------------------------------------------- |
| Status     | Draft                                              |
| Author(s)  | Vivek Vashistha                                    |
| Created    | 2026-06-17                                         |
| Updated    | 2026-06-17                                         |
| Reviewers  | TBD (CTP team, SciCode pod leads, QC pipeline owners) |
| Supersedes | —                                                  |

## TL;DR

Replace the current multi-tool SciCode workflow (Labeling Tool + Colab + Chrome Validator + RLHF playground + Google Sheets + QC Gatekeeper) with a single trainer experience built on the **Central Task Platform (CTP)** plus a new **SciCode Canvas** (Workbench guest pane).

- **CTP** owns batches, claim/submit, reviews, rework, delivery, deterministic gates, audit, and the QC pipeline integration.
- **SciCode Canvas** owns the SciCode-specific UX: notebook render + sync with Colab, Validator (golden-vs-tests), pass@k orchestration UI, model-output review, metadata, single submit.
- **Task creation pipeline** (`Scicode-Trainers-chotu`) stays external; its output `.ipynb` files are seeded into CTP as a batch.
- **Model execution for pass@k** is host-mediated through CTP (no model API keys in the canvas).

The first delivery target is end-to-end happy path: pipeline → seed → claim → edit → validator → pass@k → submit → L1/L2 review → delivery. Earnings, A/B, and per-variant routing are out of scope for v1.

## 1. Background

### 1.1 Where SciCode lives today

The current SciCode delivery workflow spans many platforms:

- **Task creation pipeline** (`Scicode-Trainers-chotu`) — fetches arXiv/OpenAlex papers, runs a 3-stage LLM pipeline, outputs `.ipynb` notebooks with draft sub-problems and tests.
- **SFT project** (`scicode-second-batch-phase-2`, project ID 170) on Labeling Tool — trainer claims and finishes the task.
- **RLHF project** (`scicode-rework-v2-RLHF`, project ID 163) — separate project where 8 GPT-5.4 instances (A–H) generate model responses for pass@8.
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
   │     • Mediates pass@k jobs (model API + sandbox)          │
   │     • Mediates Validator jobs (golden vs tests)           │
   │     • Calls scicode-qc-unified-pipeline (Tier 1 / 2)      │
   │                                                           │
   │   services/media                                          │
   │     • Stores .ipynb artifacts (createArtifactBundle)      │
   └───────────────────────────────────────────────────────────┘
                                  │ postMessage (host ↔ guest)
                                  ▼
   ┌───────────────────────────────────────────────────────────┐
   │            SciCode Canvas (new repo)                      │
   │   • Render .ipynb (read + light edit)                     │
   │   • Sync ↔ Colab (manual button)                          │
   │   • Run Validator (golden vs tests) — host RPC            │
   │   • Run pass@k (model eval) — host RPC                    │
   │   • Review per-sample model outputs                       │
   │   • Metadata: domain, subdomain, perplexity, arxiv ref    │
   │   • saveDraft + submit                                    │
   └───────────────────────────────────────────────────────────┘
```

### 4.1 Trust boundary

- Canvas runs in a sandboxed iframe at a different origin and uses `@turing/workbench-guest`.
- Canvas never holds model API keys, gateway tokens, or session cookies.
- Canvas calls only host-exposed namespaces: `task`, `quality`, `media`, `telemetry`, `correlation`, `error`, `lifecycle`, `user`.
- All execution that needs credentials (pass@k, Validator sandbox, QC pipeline) happens server-side in CTP.

### 4.2 Canvas key

`canvas_key: scicode` (already referenced in CTP mocks). The canvas is bound to the SciCode project via `pane_url` at project creation.

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
| `scicode.passk.k`                            | int      | 8 for Microsoft, 3 for Meta                            |
| `scicode.passk.main_band`                    | [lo, hi] | e.g. `[0.0, 0.34]`                                      |
| `scicode.passk.subproblem_band`              | [lo, hi] | e.g. `[0.10, 0.75]` for MS, `[0.0, 1.0]` for Meta       |
| `scicode.passk.models`                       | string[] | Allowed models (`gpt-5.4`, `gemini-3.1`)                |
| `scicode.taxonomy.allowed_domains`           | string[] | Physics, Material Science, Mathematics, Chemistry, Biology |
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

- Configurable `k` (locked to project config, e.g. 8).
- Per-model selector (gpt-5.4, gemini-3.1).
- Per-sub-problem and main-problem expected pass-rate bands shown inline.
- "Run pass@k" button → progress per sample → results table.
- Per-sample row: code, test pass/fail, pass-rate.

Data flow:

```
canvas → workbench.quality.submit({
  trigger: 'guest_pre_submission',
  kind: 'scicode_passk',
  payload: { task_id, notebook_media_id, k, models }
})
   → host → qc-bridge → orchestrates k generations × m models
   → returns { main: {...}, subproblems: [...] }
   → canvas renders + stores in payload.model_eval
```

Important: pass@k runs on demand from the canvas, **not** on submit. Submit only uses the latest stored result.

#### 6.3.5 Metadata form

Fields (all required unless stated):

- `domain` — enum from project config
- `subdomain` — L1 taxonomy enum, filtered by domain
- `paper_ref` — arXiv URL
- `perplexity_link` — URL
- `dependencies[]` — library + version
- `notes` (optional)

#### 6.3.6 Self-QC checklist

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
  readonly trainer_verdict?: 'accept' | 'reject';
  readonly trainer_note?: string;
}

export interface SciCodeModelEvalResult {
  readonly model: 'gpt-5.4' | 'gemini-3.1' | string;
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
  readonly self_qc: SciCodeSelfQc;
}
```

Drafts use the same shape; `validator` and `model_eval` are optional during draft, required for final submit.

### 6.5 SciCode-specific deterministic gates (CTP)

Registered in `services/task/src/application/deterministic-submit-gates.ts`:

| Gate                                  | Reason code                          | Source of truth          |
| ------------------------------------- | ------------------------------------ | ------------------------ |
| `scicode_metadata_complete_gate`      | `metadata_incomplete`                | `metadata` fields        |
| `scicode_taxonomy_gate`               | `taxonomy_unknown`                   | `metadata.domain/subdomain` vs config |
| `scicode_subproblem_count_gate`       | `subproblem_count_out_of_range`      | notebook spec            |
| `scicode_validator_required_gate`     | `validator_missing` / `validator_failed` | `validator`           |
| `scicode_passk_band_gate`             | `passk_main_out_of_band` / `passk_sub_out_of_band` | `model_eval` |
| `scicode_self_qc_complete_gate`       | `self_qc_incomplete`                 | `self_qc.checks`         |
| `scicode_dependency_pin_gate`         | `dependency_unpinned`                | `metadata.dependencies`  |

Same fingerprint + cache pattern as existing gates. Disable path through admin workflow config.

### 6.6 qc-bridge additions

Two new job kinds in qc-bridge:

1. `scicode_validator` — sandbox runs golden vs tests. Implementation can wrap a slim subset of `scicode-qc-unified-pipeline`'s `delivery_eval` notebook executor.
2. `scicode_passk` — orchestrates `k` generations × m models. Calls model APIs with project-bound credentials. Persists all samples.

Both surface to the canvas via `workbench.quality.submit` with a SciCode-specific `kind` field, returning a structured result the canvas stores in the payload.

### 6.7 Tier 1 + Tier 2 QC pipeline integration

The existing `scicode-qc-unified-pipeline` runs as a CTP **post-submit hook** on `task.submitted`:

1. CTP qc-bridge calls a webhook with `{ task_id, notebook_media_id, payload, client }`.
2. Pipeline runs Tier 1 (`validate_json`) + Tier 2 (`scicode_qc`) and posts a verdict back via `POST /v1/internal/tasks/:taskId/qc-verdicts`.
3. Verdict maps:
   - `pass` → `tasks.status = approved` (skips L1) — only if project policy allows auto-approve. Default is to keep human L1.
   - `fail` → `tasks.status = rework_required` with reasons surfaced in canvas re-open.
   - `inconclusive` → `quarantined`.

Pipeline stays in its own repo; only the webhook integration is new.

### 6.8 L1 / L2 review rubric in CTP

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

### Phase 2 — Validator (M)

- New qc-bridge job `scicode_validator`.
- Canvas `ValidatorPanel` with run + result rendering.
- Deterministic gate `scicode_validator_required_gate` registered (initially advisory).
- Smoke: green validator result lands in payload, fail surfaces test errors.

### Phase 3 — pass@k + per-sample review (L)

- New qc-bridge job `scicode_passk` with model API integration (gpt-5.4, gemini-3.1).
- Canvas `PassKPanel` with progress, per-sample table, accept/reject toggles.
- Deterministic gate `scicode_passk_band_gate`.
- Smoke: 8 samples run, results stored, pass-rate computed.

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

1. **Notebook editing scope in v1** — read + markdown-only, or full code edit with Pyodide? Current proposal: read + markdown-only; code edits stay in Colab.
2. **Colab ↔ CTP automation** — manual upload (v1) vs Drive API bridge. Drive bridge requires OAuth scope and a host-side service account.
3. **pass@k orchestrator** — build inside qc-bridge, or call out to a separate SciCode eval service? Reusing `scicode-qc-unified-pipeline`'s `delivery_eval` is attractive.
4. **Auto-approve on Tier 2 pass** — risk of bypassing human review. Default proposal: keep human L1; let admins opt in.
5. **Per-client config** (Meta vs Microsoft) — single project with config flags, or one project per client? Single project + config is simpler; two projects gives cleaner reporting.
6. **Earnings + payment models** — out of scope for v1, but submit payload should carry enough signal (`approved`, time on task) for AGI-OS payout decisions later.
7. **Metadata enrichment** — domain/subdomain auto-detection from paper. Could be added as a pipeline step before seed.
8. **Notebook artifact promotion** — should final approved `.ipynb` be promoted into a delivery bundle automatically, or composed at delivery release time?

## 9. Risks

| Risk                                                         | Severity | Mitigation                                                       |
| ------------------------------------------------------------ | -------- | ---------------------------------------------------------------- |
| pass@k cost (8× model calls per sub-problem × tasks)         | High     | Cache per `(task_id, notebook_hash, k, models)`; rate-limit; project budget caps |
| Colab divergence (trainer edits in Colab without sync)       | Medium   | Last-synced badge, gated submit (require sync within N minutes)  |
| `.ipynb` rendering correctness for complex cells             | Medium   | Reuse a tested ipynb renderer; explicit fallback to "Open in Colab" |
| Trainer adoption vs the existing Colab + Sheets habit        | Medium   | Phased rollout; pod lead training; keep Colab as the primary editor |
| Tier 2 LLM cost when wired as post-submit hook               | Medium   | Trigger only on `submitted_pending_qc` after deterministic pass; daily caps |
| Sandbox security for pass@k generated code                   | High     | Run in qc-bridge isolated runners; existing CTP sandbox patterns |
| Privacy of arXiv pre-prints in payload                       | Low      | Standard CTP audit + media access control                        |

## 10. Alternatives considered

1. **Keep Labeling Tool + Colab + Sheets, add only a thin status mirror in CTP.** Rejected: doesn't solve the multi-tool problem; payments and visibility stay weak.
2. **Build SciCode as an embedded CTP page (no canvas iframe).** Rejected: violates the AGIOS_BOUNDARY guidance — execution surfaces should be guest panes, not first-class CTP pages.
3. **Run pass@k directly from the canvas with Anthropic/OpenAI keys (`scicode-vibe` style).** Rejected: violates the Workbench Guest capability contract; canvas must not hold model API keys.
4. **Treat SFT and RLHF as separate canvases.** Rejected: matches current pain, doesn't unify the trainer experience.

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

