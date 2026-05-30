import { invoke } from "@tauri-apps/api/core";
import type { OpenCliExtractOutput, PageCodeResult } from "./types";
import { ExternalContextBuilder } from "@/plugins/external-context/services/ExternalContextBuilder";

const MAX_EXTRACT_CHARS = 4000;
const contextBuilder = new ExternalContextBuilder();

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("仅支持 http/https 链接");
  }
  return url.toString();
}

function extractFirstUrl(input: string): string {
  const match = input.match(/https?:\/\/[^\s"'<>]+|(?:[\w-]+\.)+[\w-]{2,}[^\s"'<>]*/i);
  if (!match) {
    throw new Error("请输入一个有效链接");
  }
  return normalizeUrl(match[0]);
}

function titleFromUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.hostname.replace(/^www\./, "");
}

function cleanExtractedText(output: OpenCliExtractOutput): string {
  const raw = [output.stdout, output.stderr].filter(Boolean).join("\n").trim();
  return raw.slice(0, MAX_EXTRACT_CHARS);
}

function escapeCodeText(value: string): string {
  return value.replace(/[`$\\]/g, "\\$&");
}

function buildReactPageCode(url: string, title: string, extractedText: string): string {
  const safeTitle = escapeCodeText(title);
  const safeUrl = escapeCodeText(url);
  const paragraphs = extractedText
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 4);

  const summaryItems = paragraphs.length > 0
    ? paragraphs.map((item) => `    "${escapeCodeText(item.slice(0, 220))}",`).join("\n")
    : `    "OpenCLI 暂未返回可用正文，这里保留为页面代码骨架。",`;

  return `import React from "react";

const source = {
  title: "${safeTitle}",
  url: "${safeUrl}",
  highlights: [
${summaryItems}
  ],
};

export default function ExtractedPage() {
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <section className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-12">
        <div className="border-b border-gray-200 pb-6">
          <p className="text-sm font-medium text-blue-600">{source.url}</p>
          <h1 className="mt-2 text-3xl font-bold">{source.title}</h1>
        </div>

        <div className="grid gap-3">
          {source.highlights.map((item) => (
            <article
              key={item}
              className="rounded-lg border border-gray-200 bg-gray-50 p-4"
            >
              <p className="text-sm leading-6 text-gray-700">{item}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
`;
}

function formatResult(result: PageCodeResult): string {
  if (result.contextMarkdown) {
    return result.contextMarkdown;
  }

  return [
    "网页上下文提取失败。",
    "",
    `链接：${result.url}`,
    `说明：${result.note}`,
  ].join("\n");
}

export class OpenCliCodegenService {
  async generateFromInput(input: string): Promise<PageCodeResult> {
    const url = extractFirstUrl(input);
    const title = titleFromUrl(url);

    try {
      const output = await invoke<OpenCliExtractOutput>("opencli_extract_page", {
        url,
      });
      const extractedText = cleanExtractedText(output);
      if (!extractedText) {
        throw new Error("OpenCLI 没有返回页面正文");
      }

      return {
        url,
        title,
        status: "opencli",
        note: `命令：${output.command}`,
        extractedText,
        code: buildReactPageCode(url, title, extractedText),
        contextMarkdown: formatWebContext(
          contextBuilder.buildWebPage({
            url,
            fallbackTitle: title,
            markdown: extractedText,
            command: output.command,
          })
        ),
      };
    } catch (error) {
      const note = String(error);
      return {
        url,
        title,
        status: "fallback",
        note,
        extractedText: "",
        code: buildReactPageCode(url, title, ""),
      };
    }
  }

  async generateMessage(input: string): Promise<string> {
    const result = await this.generateFromInput(input);
    return formatResult(result);
  }
}

function formatWebContext(context: ReturnType<ExternalContextBuilder["buildWebPage"]>): string {
  const links = context.metadata.links as Array<{ text: string; href: string }> | undefined;
  const contentLines = context.metadata.contentLines as string[] | undefined;
  const payload = {
    type: "external_context",
    version: "v3.webpage.v1",
    sourceType: context.sourceType,
    title: context.title,
    summary: context.summary,
    keyPoints: context.keyPoints,
    content: contentLines ?? [],
    links: links?.slice(0, 8) ?? [],
    actionItems: context.actionItems,
    sourceRefs: context.sourceRefs,
    metadata: {
      provider: "opencli",
      lineCount: context.metadata.lineCount,
    },
  };

  return ["ExternalContext payload:", "", "```json", JSON.stringify(payload, null, 2), "```"].join("\n");
}
