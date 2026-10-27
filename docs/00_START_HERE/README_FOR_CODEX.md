# README FOR CODEX — START HERE

This package is the canonical handoff for **LifeOS V1**.

Do not combine it with old UI prompts or old Dashboard prototypes.

## Read order

1. `/AGENTS.md`
2. `01_Product/LifeOS_V1_PRODUCT_SPEC_FINAL.md`
3. `02_UI_UX/LifeOS_V1_UIUX_Spec_FINAL.md`
4. `02_UI_UX/LifeOS_V1_Information_Architecture_FINAL.md`
5. `03_Engineering/LifeOS_CODEX_DEV_DESIGN_FINAL.md`
6. `01_Product/LifeOS_FUTURE_EXTENSIONS.md`
7. `02_UI_UX/LifeOS_V1_Final_Prototype.html`

## Source-of-truth precedence

If documents appear to conflict:

### Product behavior / V1 scope
`LifeOS_V1_PRODUCT_SPEC_FINAL.md`

### UI / navigation / interaction / information architecture
`LifeOS_V1_UIUX_Spec_FINAL.md`
and
`LifeOS_V1_Information_Architecture_FINAL.md`

### Technical implementation
`LifeOS_CODEX_DEV_DESIGN_FINAL.md`

### Future ideas
`LifeOS_FUTURE_EXTENSIONS.md` only; never pull future scope into V1 without explicit instruction.

### Prototype
The HTML prototype is a visual and interaction reference. It is not the authority for database/business rules.

## Superseded concepts

The following older concepts are explicitly superseded:

- configurable KPI-style home Dashboard
- arbitrary Card/Widget wall as homepage
- homepage multi-view dashboard as the primary mental model
- isolated modules that do not share Domain Context
- domains as rigid folders containing separate module copies
- completely hidden global search

The final model is:

**Life Landscape → Domain Context Hub → Capability → Object**

and:

**Domain is context. Module is capability.**

## Initial Codex behavior

On first run:
1. inspect repository state,
2. compare it with the canonical specs,
3. identify legacy architecture/UI that conflicts,
4. output a concise implementation/migration plan,
5. do not immediately rewrite the entire product,
6. proceed milestone by milestone.

If the repository is empty, start with M0 engineering baseline.
If an existing implementation exists, plan the smallest safe migration to the final architecture.
