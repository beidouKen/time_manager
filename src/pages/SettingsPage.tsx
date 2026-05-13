import { Settings, Database, Info } from "lucide-react";

export function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-2xl mx-auto p-8">
        <div className="flex items-center gap-3 mb-8">
          <Settings size={24} className="text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">设置</h1>
        </div>

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
              <span>V0.1.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">阶段</span>
              <span>V0 本地原型</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">技术栈</span>
              <span>Tauri 2 + React + SQLite</span>
            </div>
          </div>
          <div className="mt-4 p-3 bg-blue-50 rounded-lg">
            <p className="text-xs text-blue-700">
              V0 核心功能：Todo 管理 + 时间轴排期 + 状态流转。后续版本将引入 AI Agent、
              Heartbeat、云同步等能力。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
