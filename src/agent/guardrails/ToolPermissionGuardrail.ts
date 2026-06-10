import type { ToolManifest } from "@/agent/schemas";
import type {
  Guardrail,
  GuardrailContext,
  GuardrailResult,
} from "@/agent/guardrails/Guardrail";

interface ToolManifestLookup {
  getManifest(name: string): ToolManifest | undefined;
}

export class ToolPermissionGuardrail implements Guardrail {
  readonly name = "ToolPermissionGuardrail";
  readonly stage = "pre_tool" as const;

  constructor(private readonly tools: ToolManifestLookup) {}

  check(ctx: GuardrailContext): GuardrailResult {
    const { toolName, toolManifest, currentSkill } = ctx;
    if (!toolName || !toolManifest || !currentSkill) {
      return {
        pass: false,
        decision: "block",
        reason: "missing_required_ctx",
        evidence: {
          toolName: toolName ?? null,
          hasToolManifest: Boolean(toolManifest),
          currentSkill: currentSkill ?? null,
        },
      };
    }

    const registeredManifest = this.tools.getManifest(toolName);
    if (!registeredManifest) {
      return {
        pass: false,
        decision: "block",
        reason: "missing_required_ctx",
        evidence: {
          toolName,
          hasRegisteredManifest: false,
          currentSkill,
        },
      };
    }

    if (
      registeredManifest.name !== toolManifest.name ||
      registeredManifest.skill !== toolManifest.skill
    ) {
      return {
        pass: false,
        decision: "block",
        reason: "tool_manifest_mismatch",
        evidence: {
          toolName,
          contextManifestName: toolManifest.name,
          registeredManifestName: registeredManifest.name,
          contextSkill: toolManifest.skill,
          registeredSkill: registeredManifest.skill,
        },
      };
    }

    if (registeredManifest.skill !== currentSkill) {
      return {
        pass: false,
        decision: "block",
        reason: "tool_skill_mismatch",
        evidence: {
          toolName,
          skill: registeredManifest.skill,
          currentSkill,
        },
      };
    }

    return {
      pass: true,
      decision: "allow",
      evidence: {
        toolName,
        skill: registeredManifest.skill,
        currentSkill,
      },
    };
  }
}
