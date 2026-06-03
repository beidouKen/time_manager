// ============================================================
// OpenAICompatibleEmbeddingProvider.ts — V3.8.7 OpenAI 兼容嵌入
//
// 缺 apiKey 时不抛错（由 factory fallback deterministic）。
// 仅 env 明确配置且带 key 时才会发起 fetch。
// ============================================================

import type { EmbeddingProvider } from "@/services/rag/embedding/EmbeddingProvider";
import type { EmbeddingProviderConfig, EmbeddingVector } from "@/types/rag.types";

export interface EmbeddingProviderDescribe {
  provider: "openai_compatible";
  model: string;
  version: string;
  dimensions: number;
  externalApiEnabled: boolean;
  baseUrl: string;
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  /** 缺 key 或请求失败时为 true */
  readonly degraded: boolean;

  constructor(config: EmbeddingProviderConfig, degraded = false) {
    this.model = config.model;
    this.version = config.version;
    this.dimensions = config.dimensions;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
    this.degraded = degraded;
  }

  describe(): EmbeddingProviderDescribe {
    return {
      provider: "openai_compatible",
      model: this.model,
      version: this.version,
      dimensions: this.dimensions,
      externalApiEnabled: Boolean(this.apiKey?.trim()) && !this.degraded,
      baseUrl: this.baseUrl,
    };
  }

  private zeroVector(): EmbeddingVector {
    return new Array<number>(this.dimensions).fill(0);
  }

  private canCallApi(): boolean {
    return Boolean(this.apiKey?.trim()) && !this.degraded;
  }

  async embed(text: string): Promise<EmbeddingVector> {
    if (!this.canCallApi()) {
      console.warn(
        "[OpenAICompatibleEmbeddingProvider] apiKey missing or degraded; returning zero vector",
      );
      return this.zeroVector();
    }
    const batch = await this.embedBatch([text]);
    return batch[0] ?? this.zeroVector();
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    if (texts.length === 0) return [];
    if (!this.canCallApi()) {
      console.warn(
        "[OpenAICompatibleEmbeddingProvider] apiKey missing or degraded; returning zero vectors",
      );
      return texts.map(() => this.zeroVector());
    }

    try {
      return await this.embedBatchViaApi(texts);
    } catch (e) {
      console.warn("[OpenAICompatibleEmbeddingProvider] batch failed, falling back to sequential:", e);
      const out: EmbeddingVector[] = [];
      for (const t of texts) {
        try {
          out.push(await this.embedSingleViaApi(t));
        } catch {
          out.push(this.zeroVector());
        }
      }
      return out;
    }
  }

  private async embedBatchViaApi(texts: string[]): Promise<EmbeddingVector[]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `[OpenAICompatibleEmbeddingProvider] HTTP ${res.status}: ${await res.text()}`,
      );
    }
    const data = (await res.json()) as {
      data?: Array<{ index?: number; embedding?: number[] }>;
    };
    const items = data.data ?? [];
    if (items.length === 0) {
      throw new Error("[OpenAICompatibleEmbeddingProvider] empty embedding in response");
    }
    const sorted = [...items].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return sorted.map((item) => {
      const vec = item.embedding;
      if (!vec || vec.length === 0) return this.zeroVector();
      return vec;
    });
  }

  private async embedSingleViaApi(text: string): Promise<EmbeddingVector> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `[OpenAICompatibleEmbeddingProvider] HTTP ${res.status}: ${await res.text()}`,
      );
    }
    const data = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vec = data.data?.[0]?.embedding;
    if (!vec || vec.length === 0) {
      throw new Error("[OpenAICompatibleEmbeddingProvider] empty embedding in response");
    }
    return vec;
  }
}
