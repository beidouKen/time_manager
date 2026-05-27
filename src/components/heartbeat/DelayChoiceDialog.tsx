import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Clock, CalendarClock, Archive } from "lucide-react";
import { toast } from "sonner";
import type { TimeBlock } from "@/types/timeblock.types";
import type { PlanOption, PlanProposal } from "@/agent/types";
import { PlanProposalCard } from "@/components/shared/PlanProposalCard";
import { AgentService } from "@/agent/AgentService";
import { formatTime } from "@/lib/dateUtils";

const agentService = new AgentService();

interface DelayChoiceDialogProps {
  open: boolean;
  block: TimeBlock | null;
  onClose: () => void;
  /** 用户选择「之后做」时调用（原 delayBlock 逻辑） */
  onDelayLater: (blockId: string) => Promise<void>;
  /** 用户选择的方案已执行成功时调用（刷新界面） */
  onSuccess: () => Promise<void>;
}

type Step = "choice" | "loading_slots" | "show_slots" | "executing";

export function DelayChoiceDialog({
  open,
  block,
  onClose,
  onDelayLater,
  onSuccess,
}: DelayChoiceDialogProps) {
  const [step, setStep] = useState<Step>("choice");
  const [proposal, setProposal] = useState<PlanProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep("choice");
    setProposal(null);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleTodayChoice = async () => {
    if (!block) return;
    setStep("loading_slots");
    setError(null);
    try {
      const p = await agentService.proposeReschedule(block);
      setProposal(p);
      setStep("show_slots");
    } catch (e) {
      setError(String(e));
      setStep("choice");
    }
  };

  const handleLaterChoice = async () => {
    if (!block) return;
    setStep("executing");
    try {
      await onDelayLater(block.id);
      await onSuccess();
      toast.success("已标记为稍后处理");
      handleClose();
    } catch (e) {
      toast.error(String(e));
      setStep("choice");
    }
  };

  const handleSelectSlot = async (option: PlanOption) => {
    setStep("executing");
    setError(null);
    try {
      const result = await agentService.executePlanOption(option);
      if (result.success) {
        await onSuccess();
        toast.success(result.message || "已重新安排");
        handleClose();
      } else {
        setError(result.message);
        setStep("show_slots");
      }
    } catch (e) {
      setError(String(e));
      setStep("show_slots");
    }
  };

  if (!block) return null;

  const isLoading = step === "loading_slots" || step === "executing";

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-white rounded-xl shadow-xl p-6 focus:outline-none">
          <Dialog.Close
            className="absolute right-4 top-4 p-1 text-gray-400 hover:text-gray-700 rounded"
            onClick={handleClose}
          >
            <X size={16} />
          </Dialog.Close>

          <Dialog.Title className="text-base font-bold text-gray-900 mb-1">
            延迟这个时间块
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

          {/* Step: 选择今天还是之后 */}
          {(step === "choice" || step === "loading_slots") && (
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={handleTodayChoice}
                disabled={isLoading}
                className="flex items-center gap-3 px-4 py-3 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-left transition-colors disabled:opacity-50"
              >
                <CalendarClock size={18} className="text-blue-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-800">今天做</p>
                  <p className="text-xs text-blue-500 mt-0.5">
                    {step === "loading_slots" ? "正在查询空闲时段…" : "选择今天的空闲时段重新安排"}
                  </p>
                </div>
              </button>

              <button
                onClick={handleLaterChoice}
                disabled={isLoading}
                className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 text-left transition-colors disabled:opacity-50"
              >
                <Archive size={18} className="text-gray-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-700">之后做</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    标记为已延迟，稍后在时间轴中重新安排
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* Step: 显示空闲时段选项 */}
          {step === "show_slots" && proposal && (
            <div className="mt-4">
              <PlanProposalCard
                proposal={proposal}
                onSelect={handleSelectSlot}
                onCancel={() => setStep("choice")}
                isLoading={isLoading}
              />
            </div>
          )}

          {/* Step: 执行中 */}
          {step === "executing" && (
            <p className="mt-4 text-sm text-gray-500 text-center">正在执行...</p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
