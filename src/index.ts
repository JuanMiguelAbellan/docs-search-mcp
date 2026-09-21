import { Bm25, reciprocalRankFusion, type Scored } from './bm25.js'
import { chunkText } from './chunking.js'
import { cosine, type Embedder } from './embeddings.js'
import type { Chunk, Doc, Hit } from './types.js'

export interface IndexOptions {
  maxChunkChars?: number
  /** When given, search is hybrid: BM25 and embedding similarity fused with Reciprocal Rank Fusion. */
  embedder?: Embedder
}

export class DocumentIndex {
  private constructor(
    readonly docs: Map<string, Doc>,
    private readonly chunks: Chunk[],
    private readonly bm25: Bm25,
    private readonly embedder: Embedder | undefined,
    private readonly vectors: number[][] | undefined,
  ) {}

  static async build(docs: Doc[], { maxChunkChars = 1000, embedder }: IndexOptions = {}): Promise<DocumentIndex> {
    const chunks = docs.flatMap((d) => chunkText(d.id, d.text, maxChunkChars))
    const vectors = embedder && chunks.length ? await embedder.embed(chunks.map((c) => c.text), 'document') : undefined
    return new DocumentIndex(new Map(docs.map((d) => [d.id, d])), chunks, new Bm25(chunks), embedder, vectors)
  }

  get mode(): string {
    return this.embedder ? `hybrid (BM25 + ${this.embedder.name})` : 'BM25'
  }

  get chunkCount(): number {
    return this.chunks.length
  }

  async search(query: string, limit: number): Promise<Hit[]> {
    const candidates = Math.max(limit, 30)
    const lists: Scored[][] = [this.bm25.search(query, candidates)]
    if (this.embedder && this.vectors) {
      const [q] = await this.embedder.embed([query], 'query')
      lists.push(
        this.vectors
          .map((v, index) => ({ index, score: cosine(q!, v) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, candidates),
      )
    }
    const ranked = lists.length === 1 ? lists[0]!.slice(0, limit) : reciprocalRankFusion(lists, limit)
    return ranked.map(({ index, score }) => {
      const c = this.chunks[index]!
      return { docId: c.docId, title: this.docs.get(c.docId)!.title, start: c.start, end: c.end, score: Math.round(score * 10_000) / 10_000, text: c.text }
    })
  }
}
