# LifeOS Repository Instructions — FINAL

## Product intent

LifeOS is a single-user, local-first personal life operating system.

It helps the user:
- understand current life state and current stage,
- connect long-term direction to goals and actions,
- review and recalibrate regularly,
- make major decisions with sufficient context,
- detect meaningful issues earlier.

The primary mental model is:

**Life Landscape → Domain Context Hub → Capability → Object**

A domain is context. A module is a capability.

## Non-negotiable product constraints

- Windows-first desktop app; architecture must remain compatible with macOS.
- Local-first. No cloud backend, account system, telemetry, or multi-user features in V1.
- Do not integrate an AI/LLM API in V1. AI participates only through explicit context export.
- Do not turn LifeOS into Jira, Notion, Linear, a generic task manager, a CRM, or a BI dashboard.
- Do not use a KPI/card-wall dashboard as the LifeOS home page.
- Do not over-quantify life. Scores are optional supporting data, not the product's judgment.
- Daily maintenance must remain lightweight; advanced fields use progressive disclosure.
- Knowledge Hub/file-resource catalog is a separate future system, not a LifeOS core module.
- A single object may relate to multiple life domains. Never model domains as rigid module folders.
- Adding a life domain must reuse existing capabilities, not duplicate module instances.

## Canonical source order

Read these before architecture/product decisions:

1. `docs/product/LifeOS_V1_PRODUCT_SPEC_FINAL.md`
2. `docs/ui/LifeOS_V1_UIUX_Spec_FINAL.md`
3. `docs/ui/LifeOS_V1_Information_Architecture_FINAL.md`
4. `docs/engineering/LifeOS_CODEX_DEV_DESIGN_FINAL.md`
5. `docs/product/LifeOS_FUTURE_EXTENSIONS.md` — future only
6. `docs/ui/LifeOS_V1_Final_Prototype.html` — interaction/visual reference

Conflict precedence:
- Product behavior/scope → PRODUCT_SPEC_FINAL
- UI, navigation, information architecture → UIUX_Spec_FINAL + Information_Architecture_FINAL
- Engineering implementation → CODEX_DEV_DESIGN_FINAL
- Future ideas never override V1
- Prototype illustrates intent but does not override written product/data rules

Do not use legacy Dashboard/UI documents if they exist outside these canonical paths.

## Technical baseline

- Tauri 2 desktop shell.
- React + TypeScript + Vite frontend.
- SQLite through the Tauri SQL plugin.
- pnpm.
- Domain rules live outside UI components.
- UI components must not issue ad-hoc SQL directly.
- Persisted business facts come from SQLite; client stores are UI/session state only.
- Tauri/Rust should remain thin unless a platform capability genuinely requires Rust.

## Architecture

Keep dependency direction:

UI
→ Application Services
→ Domain
→ Repository Interfaces
→ SQLite Adapters
→ Tauri Platform Layer

Use dedicated many-to-many domain links for Domain Context.
Use explicit foreign keys for strong ownership relationships.
Use generic object links only for optional cross-module relationships not better represented by dedicated relations.

## UI architecture constraints

- Home = Life Landscape, not Dashboard.
- Domain Context Hub is a first-class page.
- From a domain, capabilities open with a domain filter/context.
- Capabilities must also be globally accessible.
- Search/command bar is visually subdued but discoverable.
- Global `+` opens bottom Quick Capture; capture first, classify later.
- Right-side detail preview is read-only.
- Full detail editing is section-level inline editing.
- Attention Center contains rule-driven signals and expandable evidence.
- Multiple themes must preserve module identity colors.
- Use weak containers; avoid Card Everywhere.

## Database rules

- Every schema change requires an ordered migration.
- Prefer transactions for multi-record writes.
- Never silently drop or rewrite user data during migration.
- Use soft delete/archive semantics where history matters.
- Domain pause/archive must preserve historical relationships.
- Backup/restore formats must carry schemaVersion.

## Engineering rules

- Before a non-trivial change, inspect the relevant specs and current code, then output a short plan.
- Keep changes scoped to the current milestone/task.
- Add tests for new domain logic and regressions.
- Avoid new production dependencies unless they materially reduce complexity.
- Prefer small, typed modules over large generic utils/services files.
- Preserve existing behavior unless the task explicitly changes it.
- Surface errors with actionable UI messages; do not swallow errors.
- Do not solve a structural UI problem by only changing colors, shadows, or border radius.
- Do not silently implement future-scope features.

## Required verification

At minimum after relevant changes:
- `pnpm test`
- `pnpm build`
- `pnpm lint` when configured

For Tauri/Rust changes:
- `cargo check`
- appropriate Tauri dev/build command when available

## Definition of done

A task is done only when:
1. requested behavior works,
2. tests cover the important rule/path,
3. migrations are included when schema changed,
4. build passes,
5. no unrelated product scope was added,
6. no canonical UI/IA constraint was violated,
7. `DEVLOG.md` records what changed, verification commands, limitations, and next step.
