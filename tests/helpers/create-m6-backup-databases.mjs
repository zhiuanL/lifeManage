import { DatabaseSync } from "node:sqlite";
import { readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../src/db/migrations");
const timestamp = "2026-09-28T08:00:00.000Z";

async function createDatabase(path, withData, legacyPath, previousPath, v21Path) {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(`CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY, applied_at TEXT NOT NULL
    )`);
    const files = (await readdir(migrationsDir))
      .filter((name) => /^\d{4}-.+\.ts$/.test(name) && name.slice(0, 4) <= "0019")
      .sort();
    if (files.length !== 19) throw new Error("M7 migrations are incomplete.");
    const contextMigration = "0020-v1-life-domain-context.ts";
    const goalLinksMigration = "0021-v1-goal-domain-links.ts";
    const actionLinksMigration = "0022-v1-action-domain-links.ts";
    const reviewLinksMigration = "0023-v1-review-domain-links.ts";
    const goalHierarchyMigration = "0024-v1-goal-hierarchy.ts";
    const goalProgressMigration = "0025-v1-goal-progress-items.ts";
    const goalLifecycleMigration = "0026-v1-goal-lifecycle.ts";
    const explorationProgressMigration = "0027-v1-exploration-progress.ts";
    const habitGoalProgressMigration = "0028-v1-habit-goal-progress.ts";
    const contributionWeightsMigration = "0029-v1-contribution-weights.ts";
    async function apply(name) {
      const exports = await import(pathToFileURL(join(migrationsDir, name)).href);
      const migrations = Object.values(exports).filter((value) =>
        value?.id === name.slice(0, -3) && Array.isArray(value.statements));
      if (migrations.length !== 1) throw new Error(`Cannot load ${name}.`);
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const statement of migrations[0].statements) db.exec(statement);
        db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
          .run(migrations[0].id, timestamp);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    for (const name of files.slice(0, 16)) await apply(name);
    if (!withData) {
      for (const name of files.slice(16)) await apply(name);
      await apply(contextMigration);
      await apply(goalLinksMigration);
      await apply(actionLinksMigration);
      await apply(reviewLinksMigration);
      await apply(goalHierarchyMigration);
      await apply(goalProgressMigration);
      await apply(goalLifecycleMigration);
      await apply(explorationProgressMigration);
      await apply(habitGoalProgressMigration);
      await apply(contributionWeightsMigration);
      await apply("0030-v1-goal-priority.ts");
      await apply("0031-v1-goal-relations.ts");
      await apply("0032-v1-life-navigation.ts");
      await apply("0033-v1-goal-direction.ts");
      await apply("0034-v1-navigation-history.ts");
      await apply("0035-v1-navigation-privacy.ts");
      await apply("0036-v1-decision-navigation.ts");
      await apply("0037-v1-decision-people.ts");
      await apply("0038-v1-decision-resources.ts");
      await apply("0039-v1-resource-ownership.ts");
      await apply("0040-v1-resource-privacy.ts");
    await apply("0041-v1-action-details.ts");
    await apply("0042-v1-action-history.ts");
      return;
    }

    db.prepare(`INSERT INTO app_metadata (key, value, updated_at) VALUES (?, ?, ?)`)
      .run("lifeos-theme", "canopy", timestamp);
    db.prepare(`INSERT INTO life_domains
      (id, name, description, focus, color_key, icon_key, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("health", "健康", "长期节奏", "规律休息", "fern", "heart", 1, timestamp, timestamp);
    db.prepare(`INSERT INTO metric_definitions
      (id, name, unit, created_at, privacy_level) VALUES (?, ?, ?, ?, ?)`)
      .run("sleep", "睡眠", "小时", timestamp, "highly_sensitive");
    db.prepare(`INSERT INTO metric_domain_links (metric_id, domain_id) VALUES (?, ?)`)
      .run("sleep", "health");
    db.prepare(`INSERT INTO metric_records
      (id, metric_id, recorded_on, value, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("sleep-1", "sleep", "2026-09-27", 7.25, "昨晚", timestamp, timestamp);
    db.prepare(`INSERT INTO goals
      (id, title, description, domain_id, status, sort_order, created_at, updated_at, privacy_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("goal-1", "保持节奏", "初始说明", "health", "active", 1,
        timestamp, timestamp, "private");
    db.prepare(`UPDATE goals SET description = ?, updated_at = ? WHERE id = ?`)
      .run("调整后的说明", "2026-09-28T09:00:00.000Z", "goal-1");
    db.prepare(`INSERT INTO actions
      (id, title, notes, domain_id, goal_id, status, scheduled_for, sort_order,
        completed_at, created_at, updated_at, privacy_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("action-1", "早睡", "今夜开始", "health", "goal-1", "completed",
        "2026-09-28", 1, timestamp, timestamp, timestamp, "private");
    db.prepare(`INSERT INTO reviews
      (id, title, reflection, insight, next_focus, domain_id, reviewed_on,
        created_at, updated_at, privacy_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("review-1", "周回顾", "休息更充分", "守住节奏", "继续观察",
        "health", "2026-09-28", timestamp, timestamp, "private");
    db.prepare(`INSERT INTO issues
      (id, title, first_seen, status, goal_id, created_at, updated_at, privacy_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("issue-1", "睡眠中断", "2026-09-27", "watching", "goal-1",
        timestamp, timestamp, "private");
    db.prepare(`INSERT INTO issue_domain_links (issue_id, domain_id) VALUES (?, ?)`)
      .run("issue-1", "health");
    db.prepare(`INSERT INTO decisions
      (id, title, decided_on, importance, status, reversibility, choice,
        goal_id, created_at, updated_at, privacy_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("decision-1", "调整作息", "2026-09-28", "major", "decided",
        "reversible", "减少晚间安排", "goal-1", timestamp, timestamp, "private");
    db.prepare(`INSERT INTO decision_domain_links (decision_id, domain_id) VALUES (?, ?)`)
      .run("decision-1", "health");
    db.prepare(`INSERT INTO inbox_items
      (id, content, source, status, target_type, target_id, created_at, updated_at, privacy_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("inbox-1", "把作息放到行动里", "inbox", "organized", "action", "action-1",
        timestamp, timestamp, "private");
    db.prepare(`INSERT INTO templates
      (id, category, name, defaults_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run("habit-template", "habit", "轻量习惯", '{"intention":"规律休息"}',
        timestamp, timestamp);
    if (db.prepare("PRAGMA foreign_key_check").all().length !== 0) {
      throw new Error("Fixture contains broken references.");
    }
    if (legacyPath) {
      const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'`).all();
      if (tables.length !== 18) throw new Error("Legacy backup table count is not 18.");
      await writeFile(legacyPath, JSON.stringify({
        format: "lifeos-backup", schemaVersion: 16,
        appVersion: "0.1.0", exportedAt: timestamp,
        data: Object.fromEntries(tables.map(({ name }) => [name,
          db.prepare(`SELECT * FROM ${name}`).all()])),
      }));
    }
    await apply(files[16]);
    db.prepare(`INSERT INTO habits
      (id, title, intention, weekly_target, stable_context, trigger_condition,
        obstacle, adjustment, start_on, archived, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("habit-1", "晚间散步", "保持节奏", 3, "晚饭后", "收拾好碗筷", "",
        "先走十分钟", "2026-09-22", 0, timestamp, timestamp);
    db.prepare("INSERT INTO habit_domain_links (habit_id, domain_id) VALUES (?, ?)")
      .run("habit-1", "health");
    db.prepare(`INSERT INTO habit_logs
      (id, habit_id, recorded_on, completed, obstacle, adjustment, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("habit-log-1", "habit-1", "2026-09-27", 1, "", "", timestamp, timestamp);
    if (db.prepare("PRAGMA foreign_key_check").all().length !== 0) {
      throw new Error("Habit fixture contains broken references.");
    }
    await apply(files[17]);
    db.prepare(`INSERT INTO people
      (id, name, relationship_type, state, important_date, last_contact,
       shared_experiences, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("person-1", "朋友", "朋友", "常联系", null, "2026-09-28",
        "一起散步", "", timestamp, timestamp);
    db.prepare("INSERT INTO person_domain_links (person_id, domain_id) VALUES (?, ?)")
      .run("person-1", "health");
    db.prepare(`INSERT INTO life_events
      (id, title, happened_on, description, person_id, goal_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("event-1", "开始散步", "2026-09-28", "一起开始", "person-1", "goal-1",
        timestamp, timestamp);
    db.prepare("INSERT INTO event_domain_links (event_id, domain_id) VALUES (?, ?)")
      .run("event-1", "health");
    db.prepare(`INSERT INTO skills
      (id, name, current_level, target_level, learning_path, practice, reflection,
       goal_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("skill-1", "作息安排", 2, 4, "逐步调整", "实践", "", "goal-1", timestamp, timestamp);
    db.prepare("INSERT INTO skill_domain_links (skill_id, domain_id) VALUES (?, ?)")
      .run("skill-1", "health");
    await apply(files[18]);
    db.prepare(`INSERT INTO resource_needs
      (id, goal_id, kind, description, skill_id, person_id, met, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("need-1", "goal-1", "skill", "练习安排能力", "skill-1", null, 0,
        timestamp, timestamp);
    db.prepare(`INSERT INTO system_assessments
      (id, period_kind, period_start, clarity, alignment, reviews, decisions,
       early_issues, adjustment, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("assessment-1", "month", "2026-09-01", "状态更清楚", "", "", "", "",
        "", timestamp, timestamp);
    if (db.prepare("PRAGMA foreign_key_check").all().length !== 0) {
      throw new Error("M7 fixture contains broken references.");
    }
    await apply(contextMigration);
    db.prepare(`UPDATE life_domains SET current_state = ?, long_term_expectation = ?,
      status = 'paused' WHERE id = 'health'`)
      .run("逐步调整", "健康且有余裕");
    db.prepare(`INSERT INTO life_domains
      (id, name, description, focus, color_key, icon_key, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("growth", "成长", "", "", "violet", "sprout", 2, timestamp, timestamp);
    if (previousPath) {
      const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'`).all();
      if (tables.length !== 29) throw new Error("V20 backup table count is not 29.");
      await writeFile(previousPath, JSON.stringify({
        format: "lifeos-backup", schemaVersion: 20,
        appVersion: "0.1.0", exportedAt: timestamp,
        data: Object.fromEntries(tables.map(({ name }) => [name,
          db.prepare(`SELECT * FROM ${name}`).all()])),
      }));
    }
    await apply(goalLinksMigration);
    db.prepare("INSERT INTO goal_domain_links (goal_id, domain_id) VALUES (?, ?)")
      .run("goal-1", "growth");
    if (v21Path) {
      const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'`).all();
      await writeFile(v21Path, JSON.stringify({
        format: "lifeos-backup", schemaVersion: 21,
        appVersion: "0.1.0", exportedAt: timestamp,
        data: Object.fromEntries(tables.map(({ name }) => [name,
          db.prepare(`SELECT * FROM ${name}`).all()])),
      }));
    }
    await apply(actionLinksMigration);
    db.prepare("INSERT INTO action_domain_links (action_id, domain_id) VALUES (?, ?)")
      .run("action-1", "growth");
    await apply(reviewLinksMigration);
    db.prepare("INSERT INTO review_domain_links (review_id, domain_id) VALUES (?, ?)")
      .run("review-1", "growth");
    await apply(goalHierarchyMigration);
    await apply(goalProgressMigration);
    db.prepare(`INSERT INTO goal_progress_items
      (id, goal_id, kind, title, target_value, current_value, weight, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("progress-1", "goal-1", "key_result", "每周稳定休息", 7, 4, 2, 0, timestamp, timestamp);
    await apply(goalLifecycleMigration);
    await apply(explorationProgressMigration);
    await apply(habitGoalProgressMigration);
    await apply(contributionWeightsMigration);
    await apply("0030-v1-goal-priority.ts");
    await apply("0031-v1-goal-relations.ts");
    await apply("0032-v1-life-navigation.ts");
    await apply("0033-v1-goal-direction.ts");
    await apply("0034-v1-navigation-history.ts");
    db.prepare("INSERT INTO life_navigation VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("navigation-1", "vision", "长期方向", "保持成长", null, timestamp, timestamp);
    await apply("0035-v1-navigation-privacy.ts");
    await apply("0036-v1-decision-navigation.ts");
    db.prepare("INSERT INTO decision_navigation_links VALUES (?, ?)").run("decision-1", "navigation-1");
    await apply("0037-v1-decision-people.ts");
    db.prepare("INSERT INTO decision_person_links VALUES (?, ?)").run("decision-1", "person-1");
    await apply("0038-v1-decision-resources.ts");
    await apply("0039-v1-resource-ownership.ts");
    await apply("0040-v1-resource-privacy.ts");
    await apply("0041-v1-action-details.ts");
    await apply("0042-v1-action-history.ts");
    db.prepare("INSERT INTO decision_resource_need_links VALUES (?, ?)").run("decision-1", "need-1");
    if (db.prepare("PRAGMA foreign_key_check").all().length !== 0) {
      throw new Error("V25 fixture contains broken references.");
    }
  } finally {
    db.close();
  }
}

if (process.argv.length < 4 || process.argv.length > 7) {
  throw new Error("Expected source and fresh SQLite paths, optionally legacy, V20, V21 backup paths.");
}
await createDatabase(process.argv[2], true, process.argv[4], process.argv[5], process.argv[6]);
await createDatabase(process.argv[3], false);
