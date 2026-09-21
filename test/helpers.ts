import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { fileURLToPath } from 'node:url'
import { loadDocuments } from '../src/corpus.js'
import { DocumentIndex } from '../src/index.js'
import { createServer } from '../src/server.js'
import type { Embedder } from '../src/embeddings.js'

export const FIXTURES = fileURLToPath(new URL('./fixtures/docs', import.meta.url))

export async function fixtureIndex(embedder?: Embedder): Promise<DocumentIndex> {
  const { docs } = await loadDocuments(FIXTURES)
  return DocumentIndex.build(docs, { embedder })
}

/** A real MCP client connected to the real server over an in-memory transport (full protocol, no subprocess). */
export async function connectedClient(embedder?: Embedder) {
  const server = createServer(await fixtureIndex(embedder))
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return { client, close: async () => { await client.close(); await server.close() } }
}

export function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? []
  return content.map((c) => c.text ?? '').join('\n')
}
