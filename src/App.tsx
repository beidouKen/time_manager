import { useEffect, useState } from "react";
import { runMigrations } from "@/db/migrations";
import { AppLayout } from "@/components/layout/AppLayout";

type DbState = "loading" | "ready" | "error";

export default function App() {
  const [dbState, setDbState] = useState<DbState>("loading");
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    runMigrations()
      .then(() => setDbState("ready"))
      .catch((e) => {
        console.error("Database migration failed:", e);
        setDbError(String(e));
        setDbState("error");
      });
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
