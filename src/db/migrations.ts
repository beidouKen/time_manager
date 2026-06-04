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

      // 使用 CREATE + INSERT + DROP 代替 RENAME，避免并发竞态
      const FINAL_TB_DDL = NEW_TABLE_DDL.replace("time_blocks_new", "time_blocks");

      if (!tbExists && tbNewExists) {
        // 部分失败恢复：time_blocks 已 DROP，time_blocks_new 残留 → 从 new 表重建
        await db.execute(FINAL_TB_DDL);
        await db.execute(`INSERT OR IGNORE INTO time_blocks SELECT * FROM time_blocks_new`);
        await db.execute(`DROP TABLE time_blocks_new`);
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
        await db.execute(FINAL_TB_DDL);
        await db.execute(`INSERT OR IGNORE INTO time_blocks SELECT * FROM time_blocks_new`);
        await db.execute(`DROP TABLE time_blocks_new`);
      } else {
        // 两表都不存在（极端情况）→ 直接创建最终表
        await db.execute(FINAL_TB_DDL);
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
  {
    // C1: Conversation / Message / Turn 基础模型
    // 建 conversations 表 + turns 表；重建 conversation_messages 表（role 加 'tool'
    // + 加 conversation_id / turn_id / deleted_at 三列）；
    // 创建 legacy-default conversation 并把旧消息全部归属它。
    //
    // 幂等守护：检查 conversations 表是否存在 + conversation_messages 是否有 conversation_id 列。
    // 部分失败恢复：conversation_messages_new 残留时清理掉。
    version: 6,
    async run(db) {
      const alreadyMigrated =
        (await tableExists(db, "conversations")) &&
        (await tableHasColumn(db, "conversation_messages", "conversation_id"));

      if (alreadyMigrated) {
        // 清理残留临时表（部分失败后重入时可能存在）
        if (await tableExists(db, "conversation_messages_new")) {
          await db.execute(`DROP TABLE conversation_messages_new`);
        }
        return;
      }

      await db.execute(`PRAGMA foreign_keys = OFF`);

      // 1. conversations 表
      await db.execute(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          title TEXT,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK(status IN ('active','archived','deleted')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          deleted_at TEXT
        )
      `);
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status)`,
      );

      // 2. turns 表
      await db.execute(`
        CREATE TABLE IF NOT EXISTS turns (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          user_message_id TEXT,
          assistant_message_id TEXT,
          trigger TEXT NOT NULL DEFAULT 'user_message'
            CHECK(trigger IN ('user_message','confirm_action','reject_action','refine_action','system')),
          status TEXT NOT NULL DEFAULT 'in_progress'
            CHECK(status IN ('in_progress','success','failed','interrupted')),
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT,
          error_message TEXT
        )
      `);
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_turns_conversation ON turns(conversation_id)`,
      );
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_turns_started ON turns(started_at)`,
      );

      // 3. 重建 conversation_messages：加 conversation_id / turn_id / deleted_at + role 加 tool
      const msgNewExists = await tableExists(db, "conversation_messages_new");
      const msgExists = await tableExists(db, "conversation_messages");

      const NEW_MSG_DDL = `CREATE TABLE IF NOT EXISTS conversation_messages_new (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
        role TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system')),
        content TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT
      )`;

      // 使用 CREATE + INSERT + DROP 代替 RENAME，避免并发竞态
      const FINAL_MSG_DDL = NEW_MSG_DDL.replace("conversation_messages_new", "conversation_messages");

      if (!msgExists && msgNewExists) {
        // 部分失败恢复：原表已 DROP，new 表残留 → 从 new 表重建
        await db.execute(FINAL_MSG_DDL);
        await db.execute(`
          INSERT OR IGNORE INTO conversation_messages
            (id, conversation_id, turn_id, role, content, metadata_json, created_at, deleted_at)
          SELECT id, conversation_id, turn_id, role, content, metadata_json, created_at, deleted_at
          FROM conversation_messages_new
        `);
        await db.execute(`DROP TABLE conversation_messages_new`);
      } else if (msgExists) {
        // 正常重建
        await db.execute(`DROP TABLE IF EXISTS conversation_messages_new`);
        await db.execute(NEW_MSG_DDL);

        // 4. 创建 legacy-default conversation（ON CONFLICT DO NOTHING 用 INSERT OR IGNORE）
        const legacyNow = new Date().toISOString();
        await db.execute(
          `INSERT OR IGNORE INTO conversations(id, title, status, created_at, updated_at)
           VALUES ('legacy-default', '历史会话', 'active', $1, $1)`,
          [legacyNow],
        );

        // 5. backfill 旧消息到 legacy-default
        await db.execute(`
          INSERT INTO conversation_messages_new
            (id, conversation_id, turn_id, role, content, metadata_json, created_at, deleted_at)
          SELECT id, 'legacy-default', NULL, role, content, metadata_json, created_at, NULL
          FROM conversation_messages
        `);

        await db.execute(`DROP TABLE conversation_messages`);
        await db.execute(FINAL_MSG_DDL);
        await db.execute(`
          INSERT OR IGNORE INTO conversation_messages
            (id, conversation_id, turn_id, role, content, metadata_json, created_at, deleted_at)
          SELECT id, conversation_id, turn_id, role, content, metadata_json, created_at, deleted_at
          FROM conversation_messages_new
        `);
        await db.execute(`DROP TABLE conversation_messages_new`);
      } else {
        // 极端情况：两表都不存在，直接创建最终表
        await db.execute(FINAL_MSG_DDL);

        // 仍然需要创建 legacy-default，之后 backfill 无数据也无妨
        const legacyNow = new Date().toISOString();
        await db.execute(
          `INSERT OR IGNORE INTO conversations(id, title, status, created_at, updated_at)
           VALUES ('legacy-default', '历史会话', 'active', $1, $1)`,
          [legacyNow],
        );
      }

      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
         ON conversation_messages(conversation_id, created_at)`,
      );
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_messages_turn ON conversation_messages(turn_id)`,
      );

      await db.execute(`PRAGMA foreign_keys = ON`);
    },
  },
  {
    // C2: Semantic Event 层
    // 1. 新建 semantic_events 表 + 5 个索引
    // 2. ALTER pending_confirmations ADD 7 个绑定列（G11）
    // 3. ALTER agent_action_logs ADD 4 个外键列（G10）
    // 全部用 tableHasColumn 守护幂等；REFERENCES 子句作为软约束写入
    version: 7,
    async run(db) {
      // ── 1. semantic_events 表 ──────────────────────────────────────────────
      if (!(await tableExists(db, "semantic_events"))) {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS semantic_events (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            turn_id TEXT,
            message_id TEXT,
            domain TEXT NOT NULL,
            intent TEXT NOT NULL,
            context_role TEXT NOT NULL,
            entities_json TEXT,
            confidence REAL NOT NULL DEFAULT 0.5,
            related_task_id TEXT,
            related_time_block_id TEXT,
            related_confirmation_id TEXT,
            related_proposal_id TEXT,
            source TEXT NOT NULL CHECK(source IN ('rule','llm','tool','system')),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            invalidated_at TEXT
          )
        `);
        await db.execute(
          `CREATE INDEX IF NOT EXISTS idx_semantic_events_conv_created
           ON semantic_events(conversation_id, created_at)`,
        );
        await db.execute(
          `CREATE INDEX IF NOT EXISTS idx_semantic_events_turn
           ON semantic_events(turn_id)`,
        );
        await db.execute(
          `CREATE INDEX IF NOT EXISTS idx_semantic_events_confirmation
           ON semantic_events(related_confirmation_id)`,
        );
        await db.execute(
          `CREATE INDEX IF NOT EXISTS idx_semantic_events_task
           ON semantic_events(related_task_id)`,
        );
        await db.execute(
          `CREATE INDEX IF NOT EXISTS idx_semantic_events_invalidated
           ON semantic_events(invalidated_at)`,
        );
      }

      // ── 2. ALTER pending_confirmations ADD（G11） ─────────────────────────
      const confCols = [
        "conversation_id",
        "turn_id",
        "message_id",
        "proposal_id",
        "related_task_id",
        "related_time_block_id",
        "metadata_json",
      ];
      for (const col of confCols) {
        if (!(await tableHasColumn(db, "pending_confirmations", col))) {
          try {
            await db.execute(
              `ALTER TABLE pending_confirmations ADD COLUMN ${col} TEXT`,
            );
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            if (!msg.includes("duplicate column")) throw e;
          }
        }
      }
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_pending_confirmations_conversation
         ON pending_confirmations(conversation_id)`,
      );
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_pending_confirmations_turn
         ON pending_confirmations(turn_id)`,
      );

      // ── 3. ALTER agent_action_logs ADD（G10） ─────────────────────────────
      const logCols = ["conversation_id", "turn_id", "message_id", "confirmation_id"];
      for (const col of logCols) {
        if (!(await tableHasColumn(db, "agent_action_logs", col))) {
          try {
            await db.execute(
              `ALTER TABLE agent_action_logs ADD COLUMN ${col} TEXT`,
            );
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            if (!msg.includes("duplicate column")) throw e;
          }
        }
      }
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_action_logs_turn
         ON agent_action_logs(turn_id)`,
      );
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_action_logs_confirmation
         ON agent_action_logs(confirmation_id)`,
      );
    },
  },
  // ── C3: active_contexts 表 ────────────────────────────────────────────────
  {
    version: 8,
    async run(db) {
      if (!(await tableExists(db, "active_contexts"))) {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS active_contexts (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            active_domain TEXT,
            active_intent TEXT,
            active_task_id TEXT,
            active_time_block_id TEXT,
            active_confirmation_id TEXT,
            active_proposal_id TEXT,
            proposal_snapshot_json TEXT,
            active_turn_id TEXT,
            status TEXT NOT NULL DEFAULT 'active'
              CHECK(status IN ('active','expired','resolved','invalidated')),
            expires_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
        await db.execute(
          `CREATE INDEX IF NOT EXISTS idx_active_contexts_conv_status
           ON active_contexts(conversation_id, status)`,
        );
        await db.execute(
          `CREATE INDEX IF NOT EXISTS idx_active_contexts_confirmation
           ON active_contexts(active_confirmation_id)`,
        );
        await db.execute(
          `CREATE INDEX IF NOT EXISTS idx_active_contexts_expires
           ON active_contexts(expires_at)`,
        );
      }
    },
  },
  // ── C5: pending_confirmations.status 追加 'invalidated'；legacy-default 一次性失效 ──
  {
    version: 9,
    async run(db) {
      // ── 段一：重建 pending_confirmations 表，CHECK 追加 'invalidated' ────────
      // SQLite 不支持 ALTER CHECK，需走重建表路径。
      const newTableName = "pending_confirmations_new";
      const alreadyMigrated = await tableHasColumn(db, "pending_confirmations", "_c5_migrated");

      if (!alreadyMigrated) {
        await db.execute(`PRAGMA foreign_keys = OFF`);

        const NEW_CONF_DDL = `CREATE TABLE IF NOT EXISTS ${newTableName} (
          id TEXT PRIMARY KEY,
          action_type TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          tool_args_json TEXT NOT NULL,
          description TEXT,
          risk_level TEXT NOT NULL DEFAULT 'medium'
            CHECK(risk_level IN ('low','medium','high')),
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending','confirmed','rejected','expired','invalidated')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT,
          conversation_id TEXT,
          turn_id TEXT,
          message_id TEXT,
          proposal_id TEXT,
          related_task_id TEXT,
          related_time_block_id TEXT,
          metadata_json TEXT,
          _c5_migrated INTEGER NOT NULL DEFAULT 1
        )`;

        const newExists = await tableExists(db, newTableName);
        const oldExists = await tableExists(db, "pending_confirmations");

        // 使用 CREATE + INSERT + DROP 代替 RENAME，避免并发场景下的 SQLite RENAME 竞态
        const FINAL_DDL = NEW_CONF_DDL.replace(newTableName, "pending_confirmations");

        if (!oldExists && newExists) {
          // 部分失败恢复：原表已 DROP，new 表残留 → 从 new 表重建
          await db.execute(FINAL_DDL);
          await db.execute(`
            INSERT OR IGNORE INTO pending_confirmations
              SELECT id, action_type, tool_name, tool_args_json, description, risk_level, status,
                     created_at, expires_at, conversation_id, turn_id, message_id, proposal_id,
                     related_task_id, related_time_block_id, metadata_json, _c5_migrated
              FROM ${newTableName}
          `);
          await db.execute(`DROP TABLE ${newTableName}`);
        } else if (oldExists) {
          await db.execute(`DROP TABLE IF EXISTS ${newTableName}`);
          await db.execute(NEW_CONF_DDL);
          await db.execute(`
            INSERT INTO ${newTableName}
              (id, action_type, tool_name, tool_args_json, description, risk_level, status,
               created_at, expires_at, conversation_id, turn_id, message_id, proposal_id,
               related_task_id, related_time_block_id, metadata_json)
            SELECT
              id, action_type, tool_name, tool_args_json, description, risk_level, status,
              created_at, expires_at, conversation_id, turn_id, message_id, proposal_id,
              related_task_id, related_time_block_id, metadata_json
            FROM pending_confirmations
          `);
          await db.execute(`DROP TABLE pending_confirmations`);
          await db.execute(FINAL_DDL);
          await db.execute(`
            INSERT OR IGNORE INTO pending_confirmations
              SELECT id, action_type, tool_name, tool_args_json, description, risk_level, status,
                     created_at, expires_at, conversation_id, turn_id, message_id, proposal_id,
                     related_task_id, related_time_block_id, metadata_json, _c5_migrated
              FROM ${newTableName}
          `);
          await db.execute(`DROP TABLE ${newTableName}`);
        } else {
          // 两表都不存在，直接创建最终表
          await db.execute(FINAL_DDL);
        }

        await db.execute(
          `CREATE INDEX IF NOT EXISTS idx_pending_confirmations_status
           ON pending_confirmations(status)`,
        );
        await db.execute(
          `CREATE INDEX IF NOT EXISTS idx_pending_confirmations_conversation
           ON pending_confirmations(conversation_id)`,
        );

        await db.execute(`PRAGMA foreign_keys = ON`);
      }

      // ── 段二：legacy-default 一次性 invalidate（幂等）────────────────────────
      // 检测 legacy-default 是否存在且其下仍有未失效的上下文，若是则 invalidate。
      const legacyRows = await db.select<{ cnt: number }[]>(
        `SELECT COUNT(*) as cnt FROM conversations
         WHERE id = 'legacy-default' AND deleted_at IS NULL`,
      );
      const hasLegacy = (legacyRows[0]?.cnt ?? 0) > 0;

      if (hasLegacy) {
        const now = new Date().toISOString();

        // 软删消息
        await db.execute(
          `UPDATE conversation_messages SET deleted_at = $1
           WHERE conversation_id = 'legacy-default' AND deleted_at IS NULL`,
          [now],
        );

        // 软删会话本体（保留行，改 status）
        await db.execute(
          `UPDATE conversations SET status = 'deleted', deleted_at = $1, updated_at = $1
           WHERE id = 'legacy-default' AND deleted_at IS NULL`,
          [now],
        );

        // active_contexts
        await db.execute(
          `UPDATE active_contexts SET status = 'invalidated', updated_at = $1
           WHERE conversation_id = 'legacy-default' AND status = 'active'`,
          [now],
        );

        // semantic_events
        await db.execute(
          `UPDATE semantic_events SET invalidated_at = $1
           WHERE conversation_id = 'legacy-default' AND invalidated_at IS NULL`,
          [now],
        );

        // pending_confirmations
        await db.execute(
          `UPDATE pending_confirmations SET status = 'invalidated'
           WHERE conversation_id = 'legacy-default' AND status = 'pending'`,
        );
      }
    },
  },

  // ─── v10: agent_trace_steps (C6) ──────────────────────────────────────────
  {
    version: 10,
    run: async (db) => {
      if (await tableExists(db, "agent_trace_steps")) return;

      await db.execute(`
        CREATE TABLE agent_trace_steps (
          id TEXT PRIMARY KEY,
          turn_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          message_id TEXT,
          step_type TEXT NOT NULL,
          step_order INTEGER NOT NULL DEFAULT 0,
          input_snapshot_json TEXT,
          output_snapshot_json TEXT,
          latency_ms INTEGER,
          error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_trace_steps_turn_id
         ON agent_trace_steps (turn_id)`,
      );
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_trace_steps_conv_created
         ON agent_trace_steps (conversation_id, created_at)`,
      );
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_trace_steps_message_id
         ON agent_trace_steps (message_id)`,
      );
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_trace_steps_step_type
         ON agent_trace_steps (step_type)`,
      );
    },
  },
];

// 单例锁：防止 React StrictMode 等场景下并发调用导致迁移竞态
let _migrationPromise: Promise<void> | null = null;

export function runMigrations(): Promise<void> {
  if (!_migrationPromise) {
    _migrationPromise = _doRunMigrations().catch((e) => {
      // 允许下次重试
      _migrationPromise = null;
      throw e;
    });
  }
  return _migrationPromise;
}

async function _doRunMigrations(): Promise<void> {
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
