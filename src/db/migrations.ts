import { getDb } from "./client";

interface Migration {
  version: number;
  statements: string[];
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        deadline TEXT,
        estimated_duration_minutes INTEGER,
        priority TEXT NOT NULL DEFAULT 'medium'
          CHECK(priority IN ('low','medium','high','urgent')),
        status TEXT NOT NULL DEFAULT 'todo'
          CHECK(status IN ('todo','scheduled','in_progress','done','cancelled')),
        category TEXT,
        is_flexible INTEGER NOT NULL DEFAULT 1,
        can_split INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT
      )`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS time_blocks (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'task'
          CHECK(type IN ('task','event','break','routine')),
        status TEXT NOT NULL DEFAULT 'scheduled'
          CHECK(status IN ('scheduled','in_progress','done','skipped','cancelled')),
        is_locked INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'manual'
          CHECK(source IN ('manual','system')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_time_blocks_task_id ON time_blocks(task_id)`,
      `CREATE INDEX IF NOT EXISTS idx_time_blocks_start ON time_blocks(start_time)`,
      `CREATE INDEX IF NOT EXISTS idx_time_blocks_date ON time_blocks(date(start_time))`,
    ],
  },
];

export async function runMigrations(): Promise<void> {
  const db = await getDb();

  // Enable foreign keys
  await db.execute("PRAGMA foreign_keys = ON");

  // Create schema version tracker
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Get current version
  const rows = await db.select<{ version: number | null }[]>(
    "SELECT MAX(version) as version FROM schema_version"
  );
  const currentVersion = rows[0]?.version ?? 0;

  // Apply pending migrations
  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      for (const stmt of migration.statements) {
        await db.execute(stmt);
      }
      await db.execute(
        "INSERT INTO schema_version (version) VALUES ($1)",
        [migration.version]
      );
    }
  }
}
