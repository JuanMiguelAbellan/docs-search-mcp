import { tokenize } from './text.js'
import type { Chunk } from './types.js'

export interface Scored {
  index: number
  score: number
}

/** Okapi BM25 over chunks (k1 = 1.5, b = 0.75). */
export class Bm25 {
  private readonly tfs: Map<string, number>[] = []
  private readonly lengths: number[] = []
  private readonly df = new Map<string, number>()
  private readonly avgLen: number

  constructor(chunks: Chunk[], private readonly k1 = 1.5, private readonly b = 0.75) {
    for (const c of chunks) {
      const tokens = tokenize(c.text)
      const tf = new Map<string, number>()
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
      this.tfs.push(tf)
      this.lengths.push(tokens.length)
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1)
    }
    this.avgLen = this.lengths.reduce((a, l) => a + l, 0) / Math.max(1, this.lengths.length)
  }

  search(query: string, k: number): Scored[] {
    const n = this.tfs.length
    const terms = [...new Set(tokenize(query))]
    const scored: Scored[] = []
    for (let i = 0; i < n; i++) {
      let score = 0
      for (const t of terms) {
        const f = this.tfs[i]!.get(t)
        if (!f) continue
        const df = this.df.get(t) ?? 0
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
        score += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.lengths[i]!) / this.avgLen)))
      }
      if (score > 0) scored.push({ index: i, score })
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, k)
  }
}

/** Reciprocal Rank Fusion: rank-based, so BM25 scores and cosine similarities need no calibration. */
export function reciprocalRankFusion(lists: Scored[][], k: number, rrfK = 60): Scored[] {
  const fused = new Map<number, number>()
  for (const list of lists) list.forEach((s, rank) => fused.set(s.index, (fused.get(s.index) ?? 0) + 1 / (rrfK + rank + 1)))
  return [...fused.entries()].map(([index, score]) => ({ index, score })).sort((a, b) => b.score - a.score).slice(0, k)
}
