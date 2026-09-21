import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface Embedder {
  readonly name: string
  embed(texts: string[], kind: 'query' | 'document'): Promise<number[][]>
}

export interface OllamaEmbedderOptions {
  model: string
  host?: string
  /** JSON file used to remember vectors between runs, keyed by (model, text). Optional. */
  cacheFile?: string
  batchSize?: number
  log?: (msg: string) => void
}

const enc = (v: number[]) => Buffer.from(new Float32Array(v).buffer).toString('base64')
const dec = (s: string) => {
  const b = Buffer.from(s, 'base64')
  return Array.from(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4))
}

export class OllamaEmbedder implements Embedder {
  readonly name: string
  private readonly host: string
  private cache: Map<string, string> | undefined

  constructor(private readonly o: OllamaEmbedderOptions) {
    this.name = `ollama:${o.model}`
    this.host = o.host ?? 'http://127.0.0.1:11434'
  }

  private async loadCache(): Promise<Map<string, string>> {
    if (this.cache) return this.cache
    this.cache = new Map()
    if (this.o.cacheFile) {
      try {
        for (const [k, v] of Object.entries(JSON.parse(await readFile(this.o.cacheFile, 'utf8')) as Record<string, string>)) this.cache.set(k, v)
      } catch {
        // no cache yet
      }
    }
    return this.cache
  }

  async embed(texts: string[], _kind: 'query' | 'document'): Promise<number[][]> {
    const cache = await this.loadCache()
    const key = (t: string) => createHash('sha256').update(`${this.o.model}\u0000${t}`).digest('hex')
    const keys = texts.map(key)
    const missing = [...new Set(keys.filter((k) => !cache.has(k)).map((k) => keys.indexOf(k)))]
    const batch = this.o.batchSize ?? 16
    for (let i = 0; i < missing.length; i += batch) {
      const idx = missing.slice(i, i + batch)
      const res = await fetch(`${this.host}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.o.model, input: idx.map((j) => texts[j]) }),
        signal: AbortSignal.timeout(120_000),
      })
      if (!res.ok) throw new Error(`Ollama /api/embed returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const data = (await res.json()) as { embeddings?: number[][] }
      if (data.embeddings?.length !== idx.length) throw new Error('Ollama returned an unexpected number of embeddings')
      idx.forEach((j, n) => cache.set(keys[j]!, enc(data.embeddings![n]!)))
      this.o.log?.(`embedded ${Math.min(i + batch, missing.length)}/${missing.length} passages`)
    }
    if (missing.length && this.o.cacheFile) {
      await mkdir(dirname(this.o.cacheFile), { recursive: true })
      await writeFile(this.o.cacheFile, JSON.stringify(Object.fromEntries(cache)))
    }
    return keys.map((k) => dec(cache.get(k)!))
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}
