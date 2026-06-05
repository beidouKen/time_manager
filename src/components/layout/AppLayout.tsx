import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { useUiStore } from "@/store/uiStore";
import { useTaskStore } from "@/store/taskStore";
import { useHeartbeatStore } from "@/store/heartbeatStore";
import { TodayPage } from "@/pages/TodayPage";
import { TodoPage } from "@/pages/TodoPage";
import { TimelinePage } from "@/pages/TimelinePage";
import { ChatPage } from "@/pages/ChatPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TodoForm } from "@/components/todo/TodoForm";
import { ScheduleTaskDialog } from "@/components/schedule/ScheduleTaskDialog";
import { TimeBlockForm } from "@/components/timeline/TimeBlockForm";
import { Toaster } from "sonner";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";

export function AppLayout() {
  const { activePage } = useUiStore();
  const runAutoArchive = useTaskStore((state) => state.runAutoArchive);
  const autoArchiveDays = useHeartbeatStore((state) => state.autoArchiveDays);

  useEffect(() => {
    runAutoArchive(autoArchiveDays).catch((e) => {
      console.warn("[AppLayout] auto archive failed:", e);
    });

    const id = setInterval(() => {
      runAutoArchive(autoArchiveDays).catch((e) => {
        console.warn("[AppLayout] auto archive failed:", e);
      });
    }, 30 * 60 * 1000);

    return () => clearInterval(id);
  }, [autoArchiveDays, runAutoArchive]);

  return (
    <ErrorBoundary>
      <div className="flex h-screen w-screen overflow-hidden bg-gray-50 select-none">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          {activePage === "today" && <TodayPage />}
          {activePage === "todo" && <TodoPage />}
          {activePage === "timeline" && <TimelinePage />}
          {activePage === "chat" && <ChatPage />}
          {activePage === "settings" && <SettingsPage />}
        </main>

        {/* Global dialogs */}
        <TodoForm />
        <ScheduleTaskDialog />
        <TimeBlockForm />
        <Toaster position="bottom-right" richColors />
      </div>
    </ErrorBoundary>
  );
}
