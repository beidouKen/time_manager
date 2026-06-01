// ============================================================
// ragRanking.ts — V3.8 RAG 检索纯函数层
//
// 设计要点：
// - 所有函数无副作用、不触 DB、不调用 LLM，方便单测全覆盖。
// - 中英混合分词：英文按非字母数字边界拆，中文按 CJK 字符逐字。
// - 评分策略：keyword 命中频次 + tag 匹配加权 + sourceType 偏好加权，
//   最终归一到 [0,1]。本期不引入 TF-IDF / BM25 / embedding，预留接口
//   未来替换为 FTS5 或 sqlite-vec。
// ============================================================

const CJK_REGEX = /[\u4e00-\u9fff]/;
const TOKEN_SPLIT_REGEX = /[^\p{L}\p{N}]+/u;

/**
 * 中英混合分词：
 * - 英文/数字：按非字母数字边界切分，并整体作为一个 token。
 * - CJK：每个汉字作为一个独立 token。
 * - 统一小写、去重、过滤空串。
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  const segments = text.toLowerCase().split(TOKEN_SPLIT_REGEX).filter(Boolean);
  for (const seg of segments) {
    if (CJK_REGEX.test(seg)) {
      for (const ch of seg) {
        if (CJK_REGEX.test(ch)) {
          if (!seen.has(ch)) {
            seen.add(ch);
            out.push(ch);
          }
        } else {
          // CJK 段内夹杂的字母数字，整体保留
          if (!seen.has(ch)) {
            seen.add(ch);
            out.push(ch);
          }
        }
      }
    } else {
      if (!seen.has(seg)) {
        seen.add(seg);
        out.push(seg);
      }
    }
  }
  return out;
}

/**
 * 段落优先 + 字数兜底切块。
 *
 * 规则：
 * 1. 先按双换行切段落，逐段累加进当前 chunk，长度超过 maxChars 时落块。
 * 2. 单段超长（> maxChars）则按字符强制切，块间保留 overlap 字符。
 * 3. 末尾不足 maxChars 的内容作为最后一块。
 * 4. 空白/纯空串被过滤。
 */
export function chunkText(
  text: string,
  maxChars = 600,
  overlap = 80,
): string[] {
  if (!text || !text.trim()) return [];
  if (maxChars <= 0) return [text];

  const safeOverlap = Math.max(0, Math.min(overlap, Math.floor(maxChars / 2)));
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);

  let current = "";
  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      flush();
      // 强制切：滑动窗口 maxChars，步长 maxChars - overlap
      const step = Math.max(1, maxChars - safeOverlap);
      for (let i = 0; i < para.length; i += step) {
        const piece = para.slice(i, i + maxChars);
        if (piece.trim()) chunks.push(piece);
        if (i + maxChars >= para.length) break;
      }
      continue;
    }
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > maxChars) {
      flush();
      current = para;
    } else {
      current = candidate;
    }
  }
  flush();
  return chunks;
}

/**
 * 计算 chunk 相关性分数（归一到 [0,1]）。
 *
 * 评分构成：
 * - keywordScore: 命中 token 频次 / (命中数 + 未命中数)
 * - tagScore: 匹配 preferredTags 的比例
 * - 总分 = 0.7 * keywordScore + 0.3 * tagScore，再 clamp 到 [0,1]。
 *
 * 任一 query token 都未命中 → 直接返回 0。
 */
export function scoreChunk(
  chunkContent: string,
  chunkTags: string[],
  queryTokens: string[],
  preferredTags?: string[],
): number {
  if (!queryTokens.length) return 0;

  const lowered = chunkContent.toLowerCase();
  let hitCount = 0;
  let totalHitOccurrences = 0;
  for (const token of queryTokens) {
    if (!token) continue;
    const occurrences = countOccurrences(lowered, token);
    if (occurrences > 0) {
      hitCount += 1;
      totalHitOccurrences += occurrences;
    }
  }
  if (hitCount === 0) return 0;

  // keywordScore: 命中比例 + 频次加成（频次再用 log 削弱避免高频词独大）
  const hitRatio = hitCount / queryTokens.length;
  const frequencyBoost = Math.min(
    0.3,
    Math.log10(1 + totalHitOccurrences) * 0.15,
  );
  const keywordScore = Math.min(1, hitRatio + frequencyBoost);

  let tagScore = 0;
  if (preferredTags && preferredTags.length > 0 && chunkTags.length > 0) {
    const chunkTagSet = new Set(chunkTags.map((t) => t.toLowerCase()));
    let matched = 0;
    for (const pref of preferredTags) {
      if (chunkTagSet.has(pref.toLowerCase())) matched += 1;
    }
    tagScore = matched / preferredTags.length;
  }

  const total = 0.7 * keywordScore + 0.3 * tagScore;
  return clamp01(total);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
