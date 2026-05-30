import { getDb } from "./client";
import type Database from "@tauri-apps/plugin-sql";

interface Migration {
  version: number;
  statements: string[];
}

interface SchemaObjectRow {
  name: string;
}

interface TableInfoRow {
  name: string;
}

const CREATE_TIME_BLOCKS_V4_SQL = (tableName: string) => `
  CREATE TABLE ${tableName} (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'task'
      CHECK(type IN ('task','event','break','routine')),
    status TEXT NOT NULL DEFAULT 'scheduled'
      CHECK(status IN ('scheduled','in_progress','done','skipped','cancelled','delayed')),
    is_locked INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual'
      CHECK(source IN ('manual','system')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    reminder_sent_at TEXT,
    start_prompt_sent_at TEXT,
    end_prompt_sent_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    skipped_at TEXT,
    delayed_at TEXT,
    feedback_note TEXT
  )
`;

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
  {
    version: 3,
    statements: [
      `CREATE TABLE IF NOT EXISTS agent_action_logs (
        id TEXT PRIMARY KEY,
        user_input TEXT NOT NULL,
        detected_intent TEXT,
        tool_name TEXT,
        tool_args_json TEXT,
        tool_result_json TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','executing','success','failed','cancelled')),
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
        content TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_conversation_messages_created
        ON conversation_messages(created_at)`,
      `CREATE TABLE IF NOT EXISTS pending_confirmations (
        id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        tool_args_json TEXT NOT NULL,
        description TEXT,
        risk_level TEXT NOT NULL DEFAULT 'medium'
          CHECK(risk_level IN ('low','medium','high')),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','confirmed','rejected','expired')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_pending_confirmations_status
        ON pending_confirmations(status)`,
    ],
  },
  {
    // V2: 重建 time_blocks 表，扩展 status CHECK 约束（新增 'delayed'），
    // 并新增 8 个执行时间戳字段。SQLite 不支持直接修改 CHECK 约束，使用重建模式。
    // PRAGMA foreign_keys = OFF/ON 包裹整个重建过程，避免 DROP TABLE 时外键报错。
    version: 4,
    statements: [],
  },
];

let migrationPromise: Promise<void> | null = null;

async function tableExists(db: Database, tableName: string): Promise<boolean> {
  const rows = await db.select<SchemaObjectRow[]>(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = $1",
    [tableName]
  );
  return rows.length > 0;
}

async function columnExists(
  db: Database,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const rows = await db.select<TableInfoRow[]>(`PRAGMA table_info(${tableName})`);
  return rows.some((row) => row.name === columnName);
}

async function ensureTimeBlockIndexes(db: Database): Promise<void> {
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_time_blocks_task_id ON time_blocks(task_id)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_time_blocks_start ON time_blocks(start_time)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_time_blocks_date ON time_blocks(date(start_time))`
  );
}

async function migrateTimeBlocksV4(db: Database): Promise<void> {
  await db.execute("PRAGMA foreign_keys = OFF");

  const hasTimeBlocks = await tableExists(db, "time_blocks");
  const hasTimeBlocksNew = await tableExists(db, "time_blocks_new");

  // Recovery path: a previous interrupted v4 run dropped time_blocks but left
  // the fully shaped temp table behind. Recreate the final table explicitly
  // instead of relying on ALTER TABLE ... RENAME, which was the failing step.
  if (!hasTimeBlocks && hasTimeBlocksNew) {
    await db.execute(CREATE_TIME_BLOCKS_V4_SQL("time_blocks"));
    await db.execute(`
      INSERT OR IGNORE INTO time_blocks
      SELECT id, task_id, title, start_time, end_time,
             type, status, is_locked, source,
             created_at, updated_at, deleted_at,
             reminder_sent_at, start_prompt_sent_at, end_prompt_sent_at,
             started_at, completed_at, skipped_at, delayed_at, feedback_note
      FROM time_blocks_new
    `);
    await db.execute("DROP TABLE time_blocks_new");
    await ensureTimeBlockIndexes(db);
    await db.execute("PRAGMA foreign_keys = ON");
    return;
  }

  if (!hasTimeBlocks) {
    await db.execute(CREATE_TIME_BLOCKS_V4_SQL("time_blocks"));
    await ensureTimeBlockIndexes(db);
    await db.execute("PRAGMA foreign_keys = ON");
    return;
  }

  const alreadyMigrated = await columnExists(db, "time_blocks", "feedback_note");
  if (alreadyMigrated) {
    if (hasTimeBlocksNew) {
      await db.execute("DROP TABLE time_blocks_new");
    }
    await ensureTimeBlockIndexes(db);
    await db.execute("PRAGMA foreign_keys = ON");
    return;
  }

  await db.execute("DROP TABLE IF EXISTS time_blocks_v4_migrated");
  await db.execute("DROP TABLE IF EXISTS time_blocks_new");
  await db.execute(CREATE_TIME_BLOCKS_V4_SQL("time_blocks_v4_migrated"));
  await db.execute(`
    INSERT INTO time_blocks_v4_migrated
    SELECT id, task_id, title, start_time, end_time,
           type, status, is_locked, source,
           created_at, updated_at, deleted_at,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    FROM time_blocks
  `);
  await db.execute("DROP TABLE time_blocks");
  await db.execute(CREATE_TIME_BLOCKS_V4_SQL("time_blocks"));
  await db.execute(`
    INSERT INTO time_blocks
    SELECT id, task_id, title, start_time, end_time,
           type, status, is_locked, source,
           created_at, updated_at, deleted_at,
           reminder_sent_at, start_prompt_sent_at, end_prompt_sent_at,
           started_at, completed_at, skipped_at, delayed_at, feedback_note
    FROM time_blocks_v4_migrated
  `);
  await db.execute("DROP TABLE time_blocks_v4_migrated");
  await ensureTimeBlockIndexes(db);
  await db.execute("PRAGMA foreign_keys = ON");
}

async function runMigrationsOnce(): Promise<void> {
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

  // Apply pending migrations in order
  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      if (migration.version === 4) {
        await migrateTimeBlocksV4(db);
      } else {
        for (const stmt of migration.statements) {
          await db.execute(stmt);
        }
      }
      await db.execute(
        "INSERT OR IGNORE INTO schema_version (version) VALUES ($1)",
        [migration.version]
      );
    }
  }
}

export async function runMigrations(): Promise<void> {
  // React StrictMode runs effects twice in development. Without this guard,
  // two concurrent migration runs can both observe the same currentVersion and
  // race to insert the same schema_version row.
  migrationPromise ??= runMigrationsOnce().finally(() => {
    migrationPromise = null;
  });
  return migrationPromise;
}
