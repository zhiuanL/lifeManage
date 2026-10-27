# ADR-001: Frontend-Owned Ordered SQLite Migrations

Status: Accepted

Date: 2026-09-22

## Context

LifeOS needs local SQLite storage and ordered, testable schema changes while
keeping Rust thin. Business rules and repositories live in TypeScript, so a
separate Rust migration system would create a second data-access boundary.

## Decision

The application runs ordered TypeScript migrations through a small
`SqliteExecutor` interface. The desktop implementation adapts the official
Tauri SQL plugin. A browser-only in-memory implementation supports tests and
Vite layout preview.

M0 creates only technical metadata:

- `schema_migrations`
- `app_metadata`

Future business tables must be introduced by a new ordered migration.

## Consequences

- Migration behavior can be unit-tested without Tauri.
- React components remain independent of SQL and plugin APIs.
- Desktop data persists in SQLite through the official plugin.
- Browser preview is explicitly ephemeral and is not a persistence mode.

## Alternatives Considered

Rust-owned migrations were rejected for M0 because they would make the Rust
layer own database behavior while TypeScript owns repositories and application
services.
