import type { Chunk } from './types.js'

/** Split a document into passages of at most `maxChars`, keeping whole blocks (paragraphs / list items /
 *  code fences separated by blank lines) together whenever they fit. Structure-aware chunking beat fixed
 *  windows at 1000 characters with every retriever in the rag-eval experiments this server builds on.
 *  Every chunk is a contiguous slice: `text.slice(chunk.start, chunk.end) === chunk.text`. */
export function chunkText(docId: string, text: string, maxChars = 1000): Chunk[] {
  if (maxChars < 100) throw new Error('maxChars must be at least 100')
  const blocks: { start: number; end: number }[] = []
  const re = /\S[\s\S]*?(?=\n[ \t]*\n|$)/g
  for (let m = re.exec(text); m; m = re.exec(text)) blocks.push({ start: m.index, end: m.index + m[0].trimEnd().length })

  const chunks: Chunk[] = []
  const push = (start: number, end: number) =>
    chunks.push({ docId, index: chunks.length, start, end, text: text.slice(start, end) })

  let curStart = -1
  let curEnd = -1
  const flush = () => {
    if (curStart >= 0) push(curStart, curEnd)
    curStart = -1
  }
  for (const b of blocks) {
    if (b.end - b.start > maxChars) {
      flush()
      // A single oversized block: cut it at whitespace so words are not split in half.
      let s = b.start
      while (s < b.end) {
        let e = Math.min(s + maxChars, b.end)
        if (e < b.end) {
          const ws = text.lastIndexOf(' ', e)
          if (ws > s + maxChars / 2) e = ws
        }
        push(s, e)
        s = e
        while (s < b.end && /\s/.test(text[s]!)) s++
      }
    } else if (curStart < 0) {
      curStart = b.start
      curEnd = b.end
    } else if (b.end - curStart <= maxChars) {
      curEnd = b.end
    } else {
      flush()
      curStart = b.start
      curEnd = b.end
    }
  }
  flush()
  return chunks
}
