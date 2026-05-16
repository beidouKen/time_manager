import { Settings, Database, Info, Bell } from "lucide-react";
import { useHeartbeatStore } from "@/store/heartbeatStore";
import { cn } from "@/lib/utils";

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1",
        checked ? "bg-blue-500" : "bg-gray-200"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

export function SettingsPage() {
  const {
    heartbeatEnabled,
    reminderBeforeMinutes,
    heartbeatIntervalSeconds,
    autoFeedbackPromptEnabled,
    updateSettings,
  } = useHeartbeatStore();

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-2xl mx-auto p-8">
        <div className="flex items-center gap-3 mb-8">
          <Settings size={24} className="text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">设置</h1>
        </div>

        {/* Heartbeat section */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center gap-2 mb-5">
            <Bell size={18} className="text-blue-600" />
            <h2 className="text-base font-semibold text-gray-800">Heartbeat 执行追踪</h2>
          </div>

          <div className="space-y-5">
            {/* 开关 */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">启用 Heartbeat</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  定时检查当日安排，自动提醒开始和反馈
                </p>
              </div>
              <Toggle
                checked={heartbeatEnabled}
                onChange={(v) => updateSettings({ heartbeatEnabled: v })}
              />
            </div>

            <div className="border-t border-gray-100" />

            {/* 提前提醒分钟数 */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">提前提醒时间</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  在时间块开始前多少分钟发出提醒
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={reminderBeforeMinutes}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(30, Number(e.target.value)));
                    updateSettings({ reminderBeforeMinutes: v });
                  }}
                  className="w-16 text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <span className="text-xs text-gray-500">分钟</span>
              </div>
            </div>

            {/* 检查间隔 */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">检查间隔</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Heartbeat 每隔多少秒检查一次当前状态
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={10}
                  max={300}
                  step={10}
                  value={heartbeatIntervalSeconds}
                  onChange={(e) => {
                    const v = Math.max(10, Math.min(300, Number(e.target.value)));
                    updateSettings({ heartbeatIntervalSeconds: v });
                  }}
                  className="w-16 text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <span className="text-xs text-gray-500">秒</span>
              </div>
            </div>

            <div className="border-t border-gray-100" />

            {/* 自动弹出结束反馈 */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">自动弹出结束反馈</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  时间块结束后自动弹出完成确认对话框
                </p>
              </div>
              <Toggle
                checked={autoFeedbackPromptEnabled}
                onChange={(v) =>
                  updateSettings({ autoFeedbackPromptEnabled: v })
                }
              />
            </div>

            <div className="p-3 bg-blue-50 rounded-lg">
              <p className="text-xs text-blue-700">
                设置保存在本地，重启应用后仍然有效。更改检查间隔需重新开启 Heartbeat 才能生效。
              </p>
            </div>
          </div>
        </section>

        {/* Data section */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Database size={18} className="text-gray-600" />
            <h2 className="text-base font-semibold text-gray-800">数据存储</h2>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-sm text-gray-500 mb-1">数据库文件</p>
              <code className="block px-3 py-2 bg-gray-50 rounded-md text-xs text-gray-700 font-mono border border-gray-200">
                time_manager.db（SQLite，存储于应用数据目录）
              </code>
            </div>
            <p className="text-xs text-gray-400">
              所有数据均保存在本地，不会上传到任何服务器。
            </p>
          </div>
        </section>

        {/* About section */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Info size={18} className="text-gray-600" />
            <h2 className="text-base font-semibold text-gray-800">关于</h2>
          </div>
          <div className="space-y-2 text-sm text-gray-600">
            <div className="flex justify-between">
              <span className="text-gray-500">版本</span>
              <span>V0.2.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">阶段</span>
              <span>V2 Heartbeat 和执行反馈</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">技术栈</span>
              <span>Tauri 2 + React + SQLite</span>
            </div>
          </div>
          <div className="mt-4 p-3 bg-blue-50 rounded-lg">
            <p className="text-xs text-blue-700">
              V2 新增 Heartbeat 执行反馈闭环：定时检查当日安排，支持 Done / Skip / Delay 三种反馈，
              Task 状态智能联动。后续版本将引入真正的 Agent 排程、云同步等能力。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
