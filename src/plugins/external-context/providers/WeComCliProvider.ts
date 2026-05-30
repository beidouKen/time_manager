import { invoke } from "@tauri-apps/api/core";
import type { CliCommandOutput, WeComCliCallInput } from "@/plugins/external-context/types";

export class WeComCliProvider {
  async help(): Promise<CliCommandOutput> {
    return invoke<CliCommandOutput>("wecom_cli_help");
  }

  async call(input: WeComCliCallInput): Promise<CliCommandOutput> {
    return invoke<CliCommandOutput>("wecom_cli_call", {
      category: input.category,
      method: input.method,
      jsonArgs: JSON.stringify(input.args ?? {}),
    });
  }
}
