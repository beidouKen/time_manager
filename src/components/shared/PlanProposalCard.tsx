import { cn } from "@/lib/utils";
import type { PlanOption, PlanProposal } from "@/agent/types";

interface PlanProposalCardProps {
  proposal: PlanProposal;
  onSelect: (option: PlanOption) => void;
  onCancel?: () => void;
  isLoading?: boolean;
}

export function PlanProposalCard({
  proposal,
  onSelect,
  onCancel,
  isLoading = false,
}: PlanProposalCardProps) {
  const hasOptions = proposal.options.length > 0;

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 space-y-2">
      {proposal.question && (
        <p className="text-xs font-medium text-blue-700">{proposal.question}</p>
      )}

      {hasOptions ? (
        <div className="space-y-1.5">
          {proposal.options.map((option, idx) => (
            <button
              key={idx}
              onClick={() => onSelect(option)}
              disabled={isLoading}
              className={cn(
                "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                "bg-white border border-blue-200 hover:bg-blue-100 hover:border-blue-400",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <span className="font-medium text-gray-800">{option.label}</span>
              {option.summary && option.summary !== option.label && (
                <span className="block text-xs text-gray-500 mt-0.5">
                  {option.summary}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500 italic">暂无可选方案</p>
      )}

      {onCancel && (
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="w-full text-center text-xs text-gray-400 hover:text-gray-600 pt-1 disabled:opacity-50"
        >
          返回
        </button>
      )}
    </div>
  );
}
