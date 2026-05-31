import Database from "@tauri-apps/plugin-sql";
import { getDb } from "./client";

interface MigrationBase {
  version: number;
}

interface StatementMigration extends MigrationBase {
  statements: string[];
  run?: never;
}

interface FunctionMigration extends MigrationBase {
  statements?: never;
  run: (db: Database) => Promise<void>;
}

type Migration = StatementMigration | FunctionMigration;

async function tableExists(db: Database, table: string): Promise<boolean> {
  const rows = await db.select<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name=$1`,
    [table],
  );
  return (rows[0]?.cnt ?? 0) > 0;
}

async function tableHasColumn(
  db: Database,
  table: string,
  column: string,
): Promise<boolean> {
  if (!(await tableExists(db, table))) return false;
  const cols = await db.select<{ name: string }[]>(
    `PRAGMA table_info(${table})`,
  );
  return cols.some((c) => c.name === column);
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
    // 重建 time_blocks 表：扩展 status CHECK（新增 'delayed'）+ 8 个执行时间戳字段。
    // 使用编程式 migration 处理所有部分失败重试场景：
    //   A. time_blocks 已有新列 → 跳过（清理残留临时表）
    //   B. time_blocks 不存在但 time_blocks_new 存在 → 直接 RENAME
    //   C. 两表都存在 → 正常重建流程
    //   D. 两表都不存在 → 从零创建
    version: 4,
    async run(db) {
      const tbExists = await tableExists(db, "time_blocks");
      const tbNewExists = await tableExists(db, "time_blocks_new");
      const alreadyMigrated = tbExists
        && await tableHasColumn(db, "time_blocks", "delayed_at");

      if (alreadyMigrated) {
        if (tbNewExists) await db.execute(`DROP TABLE time_blocks_new`);
        return;
      }

      await db.execute(`PRAGMA foreign_keys = OFF`);

      const NEW_TABLE_DDL = `CREATE TABLE IF NOT EXISTS time_blocks_new (
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
      )`;

      if (!tbExists && tbNewExists) {
        // 部分失败恢复：time_blocks 已 DROP，time_blocks_new 残留 → 直接 RENAME
        await db.execute(
          `ALTER TABLE time_blocks_new RENAME TO time_blocks`,
        );
      } else if (tbExists) {
        // 正常重建：time_blocks 存在且 schema 需要更新
        await db.execute(`DROP TABLE IF EXISTS time_blocks_new`);
        await db.execute(NEW_TABLE_DDL);
        await db.execute(`INSERT INTO time_blocks_new
          SELECT id, task_id, title, start_time, end_time,
                 type, status, is_locked, source,
                 created_at, updated_at, deleted_at,
                 NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
          FROM time_blocks`);
        await db.execute(`DROP TABLE time_blocks`);
        await db.execute(
          `ALTER TABLE time_blocks_new RENAME TO time_blocks`,
        );
      } else {
        // 两表都不存在（极端情况）→ 直接创建最终表
        await db.execute(NEW_TABLE_DDL.replace(
          "time_blocks_new",
          "time_blocks",
        ));
      }

      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_time_blocks_task_id ON time_blocks(task_id)`,
      );
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_time_blocks_start ON time_blocks(start_time)`,
      );
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_time_blocks_date ON time_blocks(date(start_time))`,
      );
      await db.execute(`PRAGMA foreign_keys = ON`);
    },
  },
  {
    // V3.7 P0-2: Heartbeat 反馈持久化 snooze。
    // 新增 feedback_snoozed_until 字段：当用户对结束反馈点「暂不处理」时，
    // 写入 now + 10min 的 ISO 时间戳。HeartbeatService.getPendingFeedback
    // 在该时间点之前不再把该 block 当作待反馈。
    // 与 end_prompt_sent_at 的语义区分：后者表示「已永久处理过提示」；
    // 前者表示「临时暂缓 N 分钟」。
    version: 5,
    async run(db) {
      const hasColumn = await tableHasColumn(
        db,
        "time_blocks",
        "feedback_snoozed_until",
      );
      if (hasColumn) return;
      try {
        await db.execute(
          `ALTER TABLE time_blocks ADD COLUMN feedback_snoozed_until TEXT`,
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("duplicate column name")) throw e;
      }
    },
  },
];

export async function runMigrations(): Promise<void> {
  const db = await getDb();

  await db.execute("PRAGMA foreign_keys = ON");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const rows = await db.select<{ version: number }[]>(
    "SELECT COALESCE(MAX(version), 0) as version FROM schema_version",
  );
  const currentVersion = Number(rows[0]?.version) || 0;

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      if (migration.run) {
        await migration.run(db);
      } else {
        for (const stmt of migration.statements) {
          await db.execute(stmt);
        }
      }
      await db.execute(
        "INSERT OR IGNORE INTO schema_version (version) VALUES ($1)",
        [migration.version],
      );
    }
  }
}
