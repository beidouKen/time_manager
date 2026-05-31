import { describe, expect, it } from "vitest";
import { ContextualPreRouter } from "@/agent/router/ContextualPreRouter";

const router = new ContextualPreRouter();

describe("ContextualPreRouter", () => {
  // ── 低信号输入 ────────────────────────────────────────────────────────────

  it("空字符串 → low_signal", () => {
    const result = router.classify("");
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("low_signal");
    expect(result!.routerSource).toBe("contextual");
  });

  it("单个标点 → low_signal", () => {
    const result = router.classify("?");
    expect(result!.domain).toBe("low_signal");
  });

  it("纯标点组合 → low_signal", () => {
    const result = router.classify("？？？");
    expect(result!.domain).toBe("low_signal");
  });

  it("单个字符（无 pending）→ low_signal", () => {
    const result = router.classify("嗯");
    expect(result!.domain).toBe("low_signal");
  });

  // ── 无 pending 状态的普通短词 → null（交给 LLM）─────────────────────────

  it("无 pending 时 '好' → null（交 LLM 处理）", () => {
    const result = router.classify("好");
    // 单字符命中 low_signal（length ≤ 1）
    expect(result!.domain).toBe("low_signal");
  });

  it("无 pending 时 '好的' → null（非极短，交 LLM）", () => {
    const result = router.classify("好的");
    expect(result).toBeNull();
  });

  it("无 pending 时 'ok' → null（交 LLM）", () => {
    const result = router.classify("ok");
    expect(result).toBeNull();
  });

  // ── Pending Confirmation + 确认词 ────────────────────────────────────────

  it("pending confirm + '好' → confirmAction", () => {
    const result = router.classify("好", { pendingConfirmationId: "conf-001" });
    // '好' 是单字符但 CONFIRM_WORDS 匹配，跳过 low_signal 短路
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("time_management");
    expect(result!.pendingAction).toEqual({ kind: "confirm", confirmationId: "conf-001" });
    expect(result!.routerSource).toBe("contextual");
  });

  it("pending confirm + '确认' → confirmAction", () => {
    const result = router.classify("确认", { pendingConfirmationId: "conf-002" });
    expect(result!.domain).toBe("time_management");
    expect(result!.pendingAction?.kind).toBe("confirm");
    expect(result!.pendingAction?.confirmationId).toBe("conf-002");
  });

  it("pending confirm + 'ok' → confirmAction", () => {
    const result = router.classify("ok", { pendingConfirmationId: "conf-003" });
    expect(result!.domain).toBe("time_management");
    expect(result!.pendingAction?.kind).toBe("confirm");
  });

  it("pending confirm + 'OK'（大写）→ confirmAction", () => {
    const result = router.classify("OK", { pendingConfirmationId: "conf-003" });
    expect(result!.domain).toBe("time_management");
    expect(result!.pendingAction?.kind).toBe("confirm");
  });

  it("pending confirm + '可以' → confirmAction", () => {
    const result = router.classify("可以", { pendingConfirmationId: "conf-004" });
    expect(result!.domain).toBe("time_management");
    expect(result!.pendingAction?.kind).toBe("confirm");
  });

  it("pending confirm + 'y' → confirmAction", () => {
    const result = router.classify("y", { pendingConfirmationId: "conf-005" });
    expect(result!.domain).toBe("time_management");
    expect(result!.pendingAction?.kind).toBe("confirm");
  });

  it("pending confirm + '好的！' → confirmAction（带标点）", () => {
    const result = router.classify("好的！", { pendingConfirmationId: "conf-006" });
    expect(result!.domain).toBe("time_management");
    expect(result!.pendingAction?.kind).toBe("confirm");
  });

  // ── Pending Confirmation + 拒绝词 ────────────────────────────────────────

  it("pending confirm + '取消' → rejectAction", () => {
    const result = router.classify("取消", { pendingConfirmationId: "conf-007" });
    expect(result!.domain).toBe("time_management");
    expect(result!.pendingAction?.kind).toBe("reject");
    expect(result!.pendingAction?.confirmationId).toBe("conf-007");
  });

  it("pending confirm + '不' → rejectAction", () => {
    const result = router.classify("不", { pendingConfirmationId: "conf-008" });
    expect(result!.domain).toBe("time_management");
    expect(result!.pendingAction?.kind).toBe("reject");
  });

  it("pending confirm + 'no' → rejectAction", () => {
    const result = router.classify("no", { pendingConfirmationId: "conf-009" });
    expect(result!.domain).toBe("time_management");
    expect(result!.pendingAction?.kind).toBe("reject");
  });

  it("pending confirm + '算了' → rejectAction", () => {
    const result = router.classify("算了", { pendingConfirmationId: "conf-010" });
    expect(result!.domain).toBe("time_management");
    expect(result!.pendingAction?.kind).toBe("reject");
  });

  // ── Pending Confirmation + 非快捷词 → null（交 LLM 处理）────────────────

  it("pending confirm + 长文本 → null（正常对话，交 LLM 处理）", () => {
    const result = router.classify("我想改一下任务的时间", { pendingConfirmationId: "conf-011" });
    expect(result).toBeNull();
  });

  // ── Pending Clarification ─────────────────────────────────────────────────

  it("pending clarify + 短补充 → time_management", () => {
    const result = router.classify("我是说写文档", { pendingClarification: true });
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("time_management");
    expect(result!.routerSource).toBe("contextual");
  });

  it("pending clarify + 长文本 → null（自然语言，交 LLM）", () => {
    const result = router.classify(
      "我想要安排一个超过30字以上的长长长长长长长长长长长长长文本任务",
      { pendingClarification: true }
    );
    expect(result).toBeNull();
  });

  // ── 确保没有 pending 时普通输入返回 null ──────────────────────────────────

  it("普通正常输入（无 pending）→ null", () => {
    const result = router.classify("帮我安排一个任务");
    expect(result).toBeNull();
  });
});
