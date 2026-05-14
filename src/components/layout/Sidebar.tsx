import { CalendarDays, Settings, Clock, MessageSquare } from "lucide-react";
import { useUiStore } from "@/store/uiStore";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const { activePage, setActivePage } = useUiStore();

  const navItems = [
    { id: "today" as const, icon: CalendarDays, label: "今天" },
    { id: "chat" as const, icon: MessageSquare, label: "助手" },
    { id: "settings" as const, icon: Settings, label: "设置" },
  ];

  return (
    <aside className="w-14 flex flex-col items-center bg-gray-900 py-4 gap-2">
      {/* Logo */}
      <div className="mb-4">
        <Clock size={24} className="text-blue-400" />
      </div>

      {navItems.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          onClick={() => setActivePage(id)}
          title={label}
          className={cn(
            "w-10 h-10 flex items-center justify-center rounded-lg transition-colors",
            activePage === id
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-700"
          )}
        >
          <Icon size={20} />
        </button>
      ))}
    </aside>
  );
}
