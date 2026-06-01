import { useEffect, useState } from "react";
import { runMigrations } from "@/db/migrations";
import { AppLayout } from "@/components/layout/AppLayout";
import { RagService } from "@/services/rag/RagService";
import { seedRagKnowledge } from "@/services/rag/seedRagKnowledge";

type DbState = "loading" | "ready" | "error";

export default function App() {
  const [dbState, setDbState] = useState<DbState>("loading");
  const [dbError, setDbError] = useState<string | null>(null); //两种类型，一种没错无输出，另一种直接输出错误

  useEffect(() => {
    (async () => {
      try {
        await runMigrations(); //成功条件是runMigration()函数必须返回的Promise必须是 “成功解决”
        // V3.8: 启动时幂等写入 RAG 种子知识；失败不阻塞主路径。
        try {
          await seedRagKnowledge(new RagService());
        } catch (seedErr) {
          console.warn("RAG seed knowledge ingestion failed:", seedErr);
        }
        setDbState("ready");
      } catch (e) {
        console.error("Database migration failed:", e);
        setDbError(String(e));
        setDbState("error");
      }
    })();
  }, []);

  if (dbState === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3 text-gray-500">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">初始化数据库...</span>
        </div>
      </div>
    );
  }

  if (dbState === "error") {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">
            数据库初始化失败
          </h2>
          <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg font-mono">
            {dbError}
          </p>
        </div>
      </div>
    );
  }

  return <AppLayout />;
}
