import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chunkText } from '../src/chunking.js'

test('every chunk is a contiguous slice of the text', () => {
  const text = '# Title\n\nFirst paragraph here.\n\nSecond paragraph, a bit longer than the first one.\n\n- item one\n- item two\n\nEnd.'
  for (const c of chunkText('d', text, 100)) assert.equal(text.slice(c.start, c.end), c.text)
})

test('blocks are merged while they fit and never split when they fit on their own', () => {
  const a = 'a'.repeat(40)
  const b = 'b'.repeat(40)
  const c = 'c'.repeat(40)
  const chunks = chunkText('d', `${a}\n\n${b}\n\n${c}`, 100)
  assert.deepEqual(chunks.map((x) => x.text), [`${a}\n\n${b}`, c])
})

test('an oversized block is cut at whitespace, not mid-word, and loses no words', () => {
  const words = Array.from({ length: 80 }, (_, i) => `word${i}`)
  const text = words.join(' ')
  const chunks = chunkText('d', text, 100)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every((c) => c.text.length <= 100))
  assert.deepEqual(chunks.flatMap((c) => c.text.split(' ')), words)
})

test('empty and whitespace-only text yields no chunks; indexes are sequential', () => {
  assert.deepEqual(chunkText('d', '  \n\n \n'), [])
  const chunks = chunkText('d', 'x'.repeat(250), 100)
  assert.deepEqual(chunks.map((c) => c.index), chunks.map((_, i) => i))
})

test('rejects an absurdly small chunk size', () => {
  assert.throws(() => chunkText('d', 'hello', 10))
})
