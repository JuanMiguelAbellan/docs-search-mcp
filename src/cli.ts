#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { resolve } from 'node:path'
import { loadDocuments } from './corpus.js'
import { OllamaEmbedder } from './embeddings.js'
import { DocumentIndex } from './index.js'
import { createServer, VERSION } from './server.js'

const HELP = `docs-search-mcp ${VERSION} — a read-only MCP server for searching a folder of documents.

usage: docs-search-mcp <folder> [options]

  --ollama-model <name>   also use Ollama embeddings (hybrid search), e.g. bge-m3
  --ollama-host <url>     default http://127.0.0.1:11434
  --cache <file>          remember embeddings between runs
  --chunk <chars>         maximum passage size (default 1000)
  -h, --help
`

// stdout is the MCP protocol channel: anything else printed there would corrupt it. All logging goes to stderr.
const log = (msg: string) => process.stderr.write(`[docs-search-mcp] ${msg}\n`)

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('-h') || args.includes('--help') || !args.length) {
    process.stderr.write(HELP)
    process.exit(args.length ? 0 : 1)
  }
  const folder = resolve(args[0]!)
  const { docs, skipped } = await loadDocuments(folder)
  for (const s of skipped) log(`skipped ${s.path}: ${s.reason}`)
  if (!docs.length) throw new Error(`no .md/.markdown/.txt documents found in ${folder}`)

  const model = option('ollama-model')
  const embedder = model
    ? new OllamaEmbedder({ model, host: option('ollama-host'), cacheFile: option('cache'), log })
    : undefined
  const chunk = Number(option('chunk') ?? 1000)
  if (!Number.isInteger(chunk) || chunk < 100) throw new Error('--chunk must be an integer >= 100')

  const index = await DocumentIndex.build(docs, { maxChunkChars: chunk, embedder })
  log(`serving ${docs.length} documents, ${index.chunkCount} passages, search: ${index.mode}`)
  await createServer(index).connect(new StdioServerTransport())
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
