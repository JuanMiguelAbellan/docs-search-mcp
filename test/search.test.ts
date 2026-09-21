import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reciprocalRankFusion } from '../src/bm25.js'
import { DocumentIndex } from '../src/index.js'
import type { Embedder } from '../src/embeddings.js'
import { fixtureIndex } from './helpers.js'

test('finds the passage that answers an English question', async () => {
  const idx = await fixtureIndex()
  const [top] = await idx.search('what is the default port of the widget server?', 3)
  assert.equal(top!.docId, 'guides/setup.md')
  assert.match(top!.text, /8080/)
})

test('finds Spanish content, ignoring accents', async () => {
  const idx = await fixtureIndex()
  const [top] = await idx.search('como limpiar la cafetera con vinagre', 3)
  assert.equal(top!.docId, 'guias.txt')
})

test('a query with no matching term returns nothing rather than noise', async () => {
  assert.deepEqual(await (await fixtureIndex()).search('zzzxqv', 5), [])
})

test('limit is honoured and hits carry the exact source range', async () => {
  const idx = await fixtureIndex()
  const hits = await idx.search('server', 1)
  assert.equal(hits.length, 1)
  const doc = idx.docs.get(hits[0]!.docId)!
  assert.equal(doc.text.slice(hits[0]!.start, hits[0]!.end), hits[0]!.text)
})

// A fake "embedding": one dimension per keyword. Deterministic, no Ollama.
const KEYWORDS = ['cafe', 'port', 'install', 'widget']
const fake: Embedder = {
  name: 'fake',
  embed: async (texts) => texts.map((t) => KEYWORDS.map((k) => (t.toLowerCase().includes(k) ? 1 : 0.001))),
}

test('hybrid mode fuses BM25 with embeddings and says so', async () => {
  const idx = await fixtureIndex(fake)
  assert.equal(idx.mode, 'hybrid (BM25 + fake)')
  const hits = await idx.search('install', 3)
  assert.equal(hits[0]!.docId, 'README.md')
})

test('an empty document set builds an empty, searchable index', async () => {
  const idx = await DocumentIndex.build([], { embedder: fake })
  assert.deepEqual(await idx.search('anything', 5), [])
})

test('RRF prefers a passage both rankers like over one either loves alone', () => {
  const fused = reciprocalRankFusion([[{ index: 1, score: 9 }, { index: 2, score: 8 }], [{ index: 3, score: 9 }, { index: 2, score: 8 }]], 3)
  assert.equal(fused[0]!.index, 2)
})
