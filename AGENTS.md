# LifeOS Repository Instructions

## Product Intent

LifeOS is a single-user, local-first personal life operating system.

The primary model is:

**Life Landscape -> Domain Context Hub -> Capability -> Object**

Domains provide context. Modules provide global capabilities. Do not model
domains as folders or duplicate module data for each domain.

## Non-Negotiable Constraints

- Windows-first desktop application with a macOS-compatible architecture.
- No cloud backend, accounts, telemetry, multi-user features, or direct AI API.
- AI participates only through explicit context export.
- The homepage is Life Landscape, never a KPI dashboard or task-card wall.
- Daily maintenance must remain lightweight and allow gaps.
- Do not pre-implement future extensions from `doc/01_Product`.

## Architecture

Keep dependency direction:

UI -> Application Services -> Domain -> Repository Interfaces -> SQLite
Adapters -> Tauri Platform Layer

- UI components never issue SQL directly.
- SQLite is the persisted source of truth; browser/client stores only hold UI
  or session state.
- Use migrations for every schema change.
- Use explicit foreign keys for strong ownership and dedicated domain links for
  domain context.
- Keep Rust thin unless a desktop/platform capability requires it.

## Working Rules

- Read the relevant documents under `doc/` before non-trivial work.
- Implement one milestone or reviewable subtask at a time.
- Add focused tests for domain rules, migrations, and regressions.
- Preserve user data; do not silently drop or rewrite it during migration.
- Update `DEVLOG.md` with completed work, verification, limitations, and the
  next milestone.

## Required Verification

Run after relevant changes:

```text
pnpm test
pnpm lint
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Canonical Sources

1. `doc/01_Product/LifeOS_V1_PRODUCT_SPEC_FINAL.md`
2. `doc/02_UI_UX/LifeOS_V1_UIUX_Spec_FINAL.md`
3. `doc/02_UI_UX/LifeOS_V1_Information_Architecture_FINAL.md`
4. `doc/03_Engineering/LifeOS_CODEX_DEV_DESIGN_FINAL.md`
5. `doc/01_Product/LifeOS_FUTURE_EXTENSIONS.md` for exclusions only
6. `doc/02_UI_UX/LifeOS_V1_Final_Prototype.html` as visual reference
