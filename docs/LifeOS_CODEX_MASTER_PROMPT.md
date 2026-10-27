# LifeOS V1 — CODEX MASTER PROMPT

You are the primary implementation agent for LifeOS V1.

Treat this as a long-lived desktop product, not a one-off demo.

## Step 1 — Read before coding

Read in this exact order:

1. `AGENTS.md`
2. `00_START_HERE/README_FOR_CODEX.md`
3. `01_Product/LifeOS_V1_PRODUCT_SPEC_FINAL.md`
4. `02_UI_UX/LifeOS_V1_UIUX_Spec_FINAL.md`
5. `02_UI_UX/LifeOS_V1_Information_Architecture_FINAL.md`
6. `03_Engineering/LifeOS_CODEX_DEV_DESIGN_FINAL.md`
7. `01_Product/LifeOS_FUTURE_EXTENSIONS.md`
8. `02_UI_UX/LifeOS_V1_Final_Prototype.html`

Do not read legacy Dashboard/UI prompts as requirements.

## Step 2 — Inspect the repository

Before any non-trivial implementation:
- inspect current files,
- dependencies,
- routes,
- database schema/migrations,
- tests,
- build configuration,
- existing UI architecture.

Compare current state against canonical specs.

## Step 3 — Output a plan first

Your first response must include:
- current capabilities,
- conflicts with canonical architecture,
- files likely to change,
- migration/data implications,
- testing plan,
- risks,
- recommended next milestone.

Do not begin broad coding before this plan unless the task is a tiny isolated fix.

## Product invariants

- Single-user.
- Local-first.
- Windows first; macOS-ready.
- No cloud backend/account/telemetry in V1.
- No direct AI/LLM API in V1.
- AI participates through explicit Context Export.
- Daily maintenance target: 5–10 minutes, interruptions allowed.
- Do not over-quantify life.
- Do not make LifeOS look or behave like Jira/Notion/Linear/project management.

## Final mental model

**Life Landscape → Domain Context Hub → Capability → Object**

**Domain is context. Module is capability.**

The homepage must help the user understand life before managing objects.

A life domain can be user-created.
Adding a domain must:
- add it to the landscape,
- create its context hub,
- reuse existing capabilities,
- never duplicate module instances.

Objects may relate to multiple domains.

## UI invariants

- Home is Life Landscape, not Dashboard.
- Search is weak-visible, not completely hidden.
- Search progressively becomes command mode.
- Global + opens bottom Quick Capture; save to Inbox first.
- Domain page is a contextual hub into goals, habits, reviews, problems, decisions, people, events, resources, Analytics.
- Modules can also be entered globally.
- Right-side detail preview is read-only.
- Full detail uses section-level inline editing.
- Calendar defaults to agenda/timeline.
- Attention Center is dedicated and evidence-explainable.
- Use weak containers, balanced density, and restrained module identities.
- Support Warm Light / Deep Black / Blue Gray Dark / Warm Dark themes.
- Never solve structural UI issues with cosmetics alone.

## Engineering baseline

- Tauri 2
- React
- TypeScript
- Vite
- SQLite
- pnpm
- Rust only where desktop/platform capability requires it
- domain/application/repository separation
- ordered migrations
- tests around domain rules and regressions

## Scope discipline

Implement one milestone or reviewable subtask at a time.

Do not pull `FUTURE_EXTENSIONS` into V1 unless explicitly requested.

When ambiguity does not change architecture:
- choose the smallest reversible implementation,
- document the assumption,
- continue.

## Verification

After relevant work:
- `pnpm test`
- `pnpm build`
- `pnpm lint` if configured
- `cargo check` / Tauri verification where applicable
- update `DEVLOG.md`

## First task

If starting from an empty repository:
- implement M0 engineering baseline only.

If a repository already exists:
- first produce a migration plan from current state to the final Life Landscape + Domain Context architecture.
- identify and remove/replace legacy Dashboard assumptions incrementally and safely.

Do not attempt the whole LifeOS in one uncontrolled change.
