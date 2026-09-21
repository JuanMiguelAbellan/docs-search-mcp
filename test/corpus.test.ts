import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadDocuments } from '../src/corpus.js'
import { extractTitle } from '../src/text.js'

async function tmp<T>(fn: (root: string, outside: string) => Promise<T>): Promise<T> {
  const base = await mkdtemp(join(tmpdir(), 'docs-mcp-'))
  const root = join(base, 'served')
  const outside = join(base, 'outside')
  await mkdir(root)
  await mkdir(outside)
  try {
    return await fn(root, outside)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

test('loads text documents with relative posix ids, sorted, and skips other files, dot-dirs and node_modules', () =>
  tmp(async (root) => {
    await mkdir(join(root, 'b'))
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'z.txt'), 'zeta')
    await writeFile(join(root, 'b', 'a.md'), '# Alpha doc\n\ntext')
    await writeFile(join(root, 'image.png'), 'not text')
    await writeFile(join(root, '.git', 'secret.md'), 'hidden')
    await writeFile(join(root, 'node_modules', 'dep.md'), 'dep')
    const { docs } = await loadDocuments(root)
    assert.deepEqual(docs.map((d) => d.id), ['b/a.md', 'z.txt'])
    assert.equal(docs[0]!.title, 'Alpha doc')
  }))

test('a symlink pointing outside the served folder is skipped, not followed', () =>
  tmp(async (root, outside) => {
    await writeFile(join(outside, 'secret.txt'), 'top secret')
    await symlink(join(outside, 'secret.txt'), join(root, 'leak.txt'))
    await symlink(outside, join(root, 'leakdir'))
    await writeFile(join(root, 'ok.txt'), 'fine')
    const { docs, skipped } = await loadDocuments(root)
    assert.deepEqual(docs.map((d) => d.id), ['ok.txt'])
    assert.ok(docs.every((d) => !d.text.includes('top secret')))
    assert.deepEqual(skipped.map((s) => s.path).sort(), ['leak.txt', 'leakdir'])
    assert.ok(skipped.every((s) => /outside/.test(s.reason)))
  }))

test('a symlink that stays inside the folder is fine', () =>
  tmp(async (root) => {
    await writeFile(join(root, 'real.txt'), 'content')
    await symlink(join(root, 'real.txt'), join(root, 'alias.txt'))
    const { docs } = await loadDocuments(root)
    assert.deepEqual(docs.map((d) => d.id), ['real.txt']) // one document, one id — not loaded twice via the alias
  }))

test('oversized, binary and excess files are reported, not loaded', () =>
  tmp(async (root) => {
    // digits sort first, so the big and binary files are visited before the file cap is reached
    await writeFile(join(root, '0-big.txt'), 'x'.repeat(2000))
    await writeFile(join(root, '0-bin.txt'), 'abc\u0000def')
    await writeFile(join(root, 'a.txt'), 'a')
    await writeFile(join(root, 'b.txt'), 'b')
    await writeFile(join(root, 'c.txt'), 'c')
    const { docs, skipped } = await loadDocuments(root, { maxFileBytes: 1000, maxFiles: 2 })
    assert.deepEqual(docs.map((d) => d.id), ['a.txt', 'b.txt'])
    const reasons = Object.fromEntries(skipped.map((s) => [s.path, s.reason]))
    assert.match(reasons['0-big.txt']!, /larger than/)
    assert.match(reasons['0-bin.txt']!, /binary/)
    assert.match(reasons['c.txt']!, /more than 2 files/)
  }))

test('titles: first heading, else first non-empty line, else the id', () => {
  assert.equal(extractTitle('intro\n\n## Real title ##\nbody', 'x'), 'Real title')
  assert.equal(extractTitle('\n\n  Just a line\nmore', 'x'), 'Just a line')
  assert.equal(extractTitle('   \n', 'fallback.md'), 'fallback.md')
})
