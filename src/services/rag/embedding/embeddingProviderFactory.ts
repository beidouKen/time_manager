// ============================================================
// embeddingProviderFactory.ts — V3.8.7 EmbeddingProvider 工厂
// ============================================================

import { DeterministicEmbeddingProvider } from "@/services/rag/embedding/DeterministicEmbeddingProvider";
import {
  OpenAICompatibleEmbeddingProvider,
  type EmbeddingProviderDescribe,
} from "@/services/rag/embedding/OpenAICompatibleEmbeddingProvider";
import type { EmbeddingProvider } from "@/services/rag/embedding/EmbeddingProvider";

export type EmbeddingProviderKind = "deterministic" | "openai_compatible";

export interface EmbeddingProviderEnv {
  provider: EmbeddingProviderKind;
  model: string;
  version: string;
  dimensions: number;
  baseUrl?: string;
  apiKey?: string;
}

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_VERSION = "v1";
const DEFAULT_DIMENSIONS = 1536;

function readEnvString(key: string): string | undefined {
  if (typeof import.meta === "undefined") return undefined;
  const v = import.meta.env?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function parseProviderKind(raw: string | undefined): EmbeddingProviderKind {
  if (raw === "openai_compatible" || raw === "openai") return "openai_compatible";
  return "deterministic";
}

export function resolveEmbeddingProviderEnv(): EmbeddingProviderEnv {
  const provider = parseProviderKind(readEnvString("VITE_RAG_EMBEDDING_PROVIDER"));
  const model = readEnvString("VITE_RAG_EMBEDDING_MODEL") ?? DEFAULT_MODEL;
  const version = readEnvString("VITE_RAG_EMBEDDING_VERSION") ?? DEFAULT_VERSION;
  const dimRaw = readEnvString("VITE_RAG_EMBEDDING_DIMENSIONS");
  const dimensions = dimRaw ? Number.parseInt(dimRaw, 10) || DEFAULT_DIMENSIONS : DEFAULT_DIMENSIONS;
  const baseUrl =
    readEnvString("VITE_RAG_EMBEDDING_BASE_URL") ??
    readEnvString("VITE_OPENAI_BASE_URL");
  const apiKey =
    readEnvString("VITE_RAG_EMBEDDING_API_KEY") ??
    readEnvString("VITE_OPENAI_API_KEY");

  return { provider, model, version, dimensions, baseUrl, apiKey };
}

export function createEmbeddingProviderFromEnv(
  env: EmbeddingProviderEnv = resolveEmbeddingProviderEnv(),
): EmbeddingProvider {
  if (env.provider === "openai_compatible") {
    if (!env.apiKey?.trim()) {
      console.warn(
        "[embeddingProviderFactory] openai_compatible requested but no API key; fallback to deterministic",
      );
      return new DeterministicEmbeddingProvider();
    }
    return new OpenAICompatibleEmbeddingProvider({
      model: env.model,
      version: env.version,
      dimensions: env.dimensions,
      apiKey: env.apiKey,
      baseUrl: env.baseUrl,
    });
  }
  return new DeterministicEmbeddingProvider();
}

/** 创建默认嵌入提供者（缺 key 自动 fallback deterministic）。 */
export function createDefaultEmbeddingProvider(): EmbeddingProvider {
  try {
    return createEmbeddingProviderFromEnv();
  } catch (e) {
    console.warn("[embeddingProviderFactory] create failed, fallback deterministic:", e);
    return new DeterministicEmbeddingProvider();
  }
}

export type EmbeddingProviderDescription =
  | (EmbeddingProviderDescribe & { provider: "openai_compatible" })
  | {
      provider: "deterministic";
      model: string;
      version: string;
      dimensions: number;
      externalApiEnabled: false;
      baseUrl: string;
    };

export function describeEmbeddingProvider(
  provider: EmbeddingProvider,
): EmbeddingProviderDescription {
  if (provider instanceof OpenAICompatibleEmbeddingProvider) {
    const d = provider.describe();
    return { ...d, provider: "openai_compatible" };
  }
  return {
    provider: "deterministic",
    model: provider.model,
    version: provider.version,
    dimensions: provider.dimensions,
    externalApiEnabled: false,
    baseUrl: "",
  };
}
