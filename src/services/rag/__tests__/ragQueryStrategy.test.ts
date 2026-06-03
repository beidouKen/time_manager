// ============================================================
// ragQueryStrategy.test.ts — V3.8.6 DefaultRagQueryStrategy
// ============================================================

import { describe, expect, it } from "vitest";
import { DefaultRagQueryStrategy } from "@/services/rag/query/DefaultRagQueryStrategy";
import defaultStrategySource from "@/services/rag/query/DefaultRagQueryStrategy.ts?raw";

describe("DefaultRagQueryStrategy", () => {
  const strategy = new DefaultRagQueryStrategy();

  it("合并 userInput 与 task/block titles 并去重", () => {
    const plan = strategy.buildQuery({
      userInput: "  安排今天  ",
      taskTitles: ["安排今天", "写周报"],
      blockTitles: ["写周报", "午休"],
    });
    expect(plan.queryText).toContain("安排今天");
    expect(plan.queryText).toContain("写周报");
    expect(plan.queryText).toContain("午休");
    const lower = plan.queryText.toLowerCase();
    expect(lower.split("安排今天").length - 1).toBe(1);
    expect(plan.reason).toBe("user_input_with_context");
  });

  it("空 userInput 且无 titles 返回 empty_input", () => {
    const plan = strategy.buildQuery({ userInput: "   " });
    expect(plan.queryText).toBe("");
    expect(plan.reason).toBe("empty_input");
  });

  it("仅 titles 时仍可构建查询", () => {
    const plan = strategy.buildQuery({
      userInput: "",
      taskTitles: ["专注块"],
    });
    expect(plan.queryText).toBe("专注块");
    expect(plan.reason).toBe("context_titles_only");
  });

  it("超长查询截断到 256", () => {
    const plan = strategy.buildQuery({
      userInput: "a".repeat(300),
    });
    expect(plan.queryText.length).toBeLessThanOrEqual(256);
  });

  it("不含 LLM 调用", () => {
    expect(defaultStrategySource).not.toMatch(/openai|fetch\(|embed\(/i);
    expect(defaultStrategySource).not.toMatch(/ToolRouter/);
  });
});
