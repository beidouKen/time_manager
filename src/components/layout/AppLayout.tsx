import { Sidebar } from "./Sidebar";
import { useUiStore } from "@/store/uiStore";
import { TodayPage } from "@/pages/TodayPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TodoForm } from "@/components/todo/TodoForm";
import { ScheduleTaskDialog } from "@/components/schedule/ScheduleTaskDialog";
import { TimeBlockForm } from "@/components/timeline/TimeBlockForm";
import { Toaster } from "sonner";

export function AppLayout() {
  const { activePage } = useUiStore();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50 select-none">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        {activePage === "today" && <TodayPage />}
        {activePage === "settings" && <SettingsPage />}
      </main>

      {/* Global dialogs */}
      <TodoForm />
      <ScheduleTaskDialog />
      <TimeBlockForm />
      <Toaster position="bottom-right" richColors />
    </div>
  );
}
