export interface OpenCliExtractOutput {
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
}

export interface PageCodeResult {
  url: string;
  title: string;
  status: "opencli" | "fallback";
  note: string;
  extractedText: string;
  code: string;
  contextMarkdown?: string;
}
