import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Check, Scissors, ChevronsRight, Clock } from "lucide-react";
import { toast } from "sonner";
import { useHeartbeatStore } from "@/store/heartbeatStore";
import { useTimeBlockStore } from "@/store/timeBlockStore";
import { useTaskStore } from "@/store/taskStore";
import { formatTime } from "@/lib/dateUtils";
import type { PlanOption, PlanProposal } from "@/agent/types";
import { PlanProposalCard } from "@/components/shared/PlanProposalCard";
import { AgentService } from "@/agent/AgentService";

const agentService = new AgentService();

type FeedbackStep =
  | "main"
  | "loading_split"
  | "show_split"
  | "loading_extend"
  | "show_extend"
  | "executing";

export function ExecutionFeedbackDialog() {
  const {
    isFeedbackDialogOpen,
    pendingFeedbackBlock,
    closeFeedbackDialog,
    completeBlock,
    skipBlock,
    openDelayDialog,
  } = useHeartbeatStore();
  const { refreshBlocks } = useTimeBlockStore();
  const { loadTasks } = useTaskStore();
  const [feedbackNote, setFeedbackNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<FeedbackStep>("main");
  const [proposal, setProposal] = useState<PlanProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!pendingFeedbackBlock) return null;

  const block = pendingFeedbackBlock;

  const resetStep = () => {
    setStep("main");
    setProposal(null);
    setError(null);
  };

  const handleClose = () => {
    resetStep();
    setFeedbackNote("");
    closeFeedbackDialog();
  };

  const handleComplete = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await completeBlock(block.id, feedbackNote || undefined);
      await Promise.all([refreshBlocks(), loadTasks()]);
      setFeedbackNote("");
      resetStep();
      toast.success("太棒了！已标记完成");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = () => {
    // 暂不处理：关闭弹窗但不写 end_prompt_sent_at，10 分钟后会再次询问
    handleClose();
    toast("已暂缓，稍后会再次提醒", { duration: 2000 });
  };

  const handleSplit = async () => {
    setStep("loading_split");
    setError(null);
    try {
      const p = await agentService.proposeEndFeedback(block, "split");
      setProposal(p);
      setStep("show_split");
    } catch (e) {
      setError(String(e));
      setStep("main");
    }
  };

  const handleExtend = async () => {
    setStep("loading_extend");
    setError(null);
    try {
      const p = await agentService.proposeEndFeedback(block, "extend");
      setProposal(p);
      setStep("show_extend");
    } catch (e) {
      setError(String(e));
      setStep("main");
    }
  };

  const handleSelectOption = async (option: PlanOption) => {
    const isSplitOption = option.toolName === "create_task";
    setStep("executing");
    setError(null);
    try {
      const result = await agentService.executePlanOption(option);
      if (result.success) {
        await Promise.all([refreshBlocks(), loadTasks()]);
        // 对于拆分：原时间块标记为跳过（移出待反馈队列）
        if (isSplitOption) {
          try {
            await skipBlock(block.id, feedbackNote || undefined);
          } catch (e) {
            console.error(
              "[ExecutionFeedbackDialog] Failed to update original block after split:",
              e
            );
            await Promise.all([refreshBlocks(), loadTasks()]);
            const message =
              "剩余任务已创建，但原时间块状态更新失败，请重试或手动处理。";
            setError(message);
            setStep("show_split");
            toast.error(message);
            return;
          }
        }
        toast.success(result.message || "操作成功");
        resetStep();
        setFeedbackNote("");
        closeFeedbackDialog();
      } else {
        setError(result.message);
        setStep(isSplitOption ? "show_split" : "show_extend");
      }
    } catch (e) {
      setError(String(e));
      setStep(isSplitOption ? "show_split" : "show_extend");
    }
  };

  const handleDelayClick = () => {
    closeFeedbackDialog();
    openDelayDialog(block);
  };

  const isLoading = loading || step === "loading_split" || step === "loading_extend" || step === "executing";

  return (
    <Dialog.Root
      open={isFeedbackDialogOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-white rounded-xl shadow-xl p-6 focus:outline-none">
          {/* 关闭按钮 */}
          <Dialog.Close
            className="absolute right-4 top-4 p-1 text-gray-400 hover:text-gray-700 rounded"
            onClick={handleClose}
          >
            <X size={16} />
          </Dialog.Close>

          {/* 标题 */}
          <Dialog.Title className="text-base font-bold text-gray-900 mb-1">
            刚才的安排完成了吗？
          </Dialog.Title>

          {/* 时间块信息 */}
          <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
            <p className="text-sm font-semibold text-gray-800">{block.title}</p>
            <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
              <Clock size={11} />
              {formatTime(block.start_time)} – {formatTime(block.end_time)}
            </p>
          </div>

          {error && (
            <p className="mt-3 text-xs text-red-500 bg-red-50 rounded px-3 py-2">
              {error}
            </p>
          )}

          {/* Step: 主选项 */}
          {step === "main" && (
            <>
              {/* 备注输入（可选） */}
              <div className="mt-4">
                <label className="block text-xs text-gray-500 mb-1.5">
                  备注（可选）
                </label>
                <textarea
                  value={feedbackNote}
                  onChange={(e) => setFeedbackNote(e.target.value)}
                  placeholder="简单记录一下..."
                  rows={2}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>

              {/* 四选项按钮 */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={handleComplete}
                  disabled={isLoading}
                  className="flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 transition-colors col-span-2"
                >
                  <Check size={14} />
                  已完成
                </button>

                <button
                  onClick={handleSplit}
                  disabled={isLoading}
                  className="flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50 transition-colors"
                >
                  <Scissors size={13} />
                  拆成剩余任务
                </button>

                <button
                  onClick={handleExtend}
                  disabled={isLoading}
                  className="flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 disabled:opacity-50 transition-colors"
                >
                  <ChevronsRight size={13} />
                  延长当前任务
                </button>

                <button
                  onClick={handleDelayClick}
                  disabled={isLoading}
                  className="flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg bg-orange-50 text-orange-600 hover:bg-orange-100 disabled:opacity-50 transition-colors"
                >
                  延迟安排
                </button>

                <button
                  onClick={handleDismiss}
                  disabled={isLoading}
                  className="flex items-center justify-center gap-1.5 py-2 text-sm text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
                >
                  暂不处理
                </button>
              </div>

              <p className="mt-3 text-xs text-gray-400 text-center">
                「暂不处理」将在 10 分钟后再次提醒
              </p>
            </>
          )}

          {/* Step: 加载中 */}
          {(step === "loading_split" || step === "loading_extend" || step === "executing") && (
            <p className="mt-4 text-sm text-gray-500 text-center">正在处理...</p>
          )}

          {/* Step: 拆分方案 */}
          {step === "show_split" && proposal && (
            <div className="mt-4">
              <PlanProposalCard
                proposal={proposal}
                onSelect={handleSelectOption}
                onCancel={resetStep}
                isLoading={isLoading}
              />
            </div>
          )}

          {/* Step: 延长方案 */}
          {step === "show_extend" && proposal && (
            <div className="mt-4">
              <PlanProposalCard
                proposal={proposal}
                onSelect={handleSelectOption}
                onCancel={resetStep}
                isLoading={isLoading}
              />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
