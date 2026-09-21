import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VERSION } from '../src/server.js'
import { readFileSync } from 'node:fs'
import { connectedClient, textOf } from './helpers.js'

type Structured = Record<string, any>

/** Invalid arguments may surface as a protocol error or as an isError result depending on SDK version; both are a rejection. */
async function rejected(call: Promise<unknown>): Promise<boolean> {
  try {
    const r = (await call) as { isError?: boolean }
    return r.isError === true
  } catch {
    return true
  }
}

test('advertises exactly three read-only tools, all annotated', async () => {
  const { client, close } = await connectedClient()
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map((t) => t.name).sort(), ['list_documents', 'read_document', 'search_documents'])
  for (const t of tools) {
    assert.equal(t.annotations?.readOnlyHint, true, t.name)
    assert.equal(t.annotations?.destructiveHint, false, t.name)
    assert.ok(t.outputSchema, `${t.name} declares an output schema`)
  }
  await close()
})

test('server version matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(VERSION, pkg.version)
})

test('list_documents returns every fixture with structured content, and pages', async () => {
  const { client, close } = await connectedClient()
  const all = (await client.callTool({ name: 'list_documents', arguments: {} })).structuredContent as Structured
  assert.equal(all.total, 3)
  assert.deepEqual(all.documents.map((d: Structured) => d.id), ['README.md', 'guias.txt', 'guides/setup.md'])
  const page = await client.callTool({ name: 'list_documents', arguments: { offset: 1, limit: 1 } })
  assert.equal((page.structuredContent as Structured).documents[0].id, 'guias.txt')
  assert.match(textOf(page), /1 more \(use offset=2\)/)
  await close()
})

test('search_documents returns the answering passage with its source', async () => {
  const { client, close } = await connectedClient()
  const r = await client.callTool({ name: 'search_documents', arguments: { query: 'default port of the widget server', limit: 2 } })
  const results = (r.structuredContent as Structured).results
  assert.equal(results[0].id, 'guides/setup.md')
  assert.match(results[0].text, /8080/)
  assert.match(textOf(r), /guides\/setup\.md/)
  await close()
})

test('search_documents says so when nothing matches', async () => {
  const { client, close } = await connectedClient()
  const r = await client.callTool({ name: 'search_documents', arguments: { query: 'zzzxqv' } })
  assert.deepEqual((r.structuredContent as Structured).results, [])
  assert.match(textOf(r), /No passages matched/)
  await close()
})

test('read_document pages through a document without losing or repeating text', async () => {
  const { client, close } = await connectedClient()
  const full = readFileSync(new URL('./fixtures/docs/guides/setup.md', import.meta.url), 'utf8')
  let offset = 0
  let rebuilt = ''
  for (let guard = 0; guard < 100; guard++) {
    const r = await client.callTool({ name: 'read_document', arguments: { id: 'guides/setup.md', offset, length: 60 } })
    const s = r.structuredContent as Structured
    rebuilt += s.text
    if (s.nextOffset === null) break
    assert.equal(s.nextOffset, offset + s.text.length)
    offset = s.nextOffset
  }
  assert.equal(rebuilt, full)
  await close()
})

test('read_document: unknown ids are errors with suggestions; path-like ids never touch the filesystem', async () => {
  const { client, close } = await connectedClient()
  const near = await client.callTool({ name: 'read_document', arguments: { id: 'setup.md' } })
  assert.equal(near.isError, true)
  assert.match(textOf(near), /Did you mean: guides\/setup\.md/)

  for (const id of ['../../../etc/passwd', '/etc/passwd', 'guides/../../package.json', 'C:\\Windows\\win.ini', 'guides/setup.md\u0000.txt']) {
    const r = await client.callTool({ name: 'read_document', arguments: { id } })
    assert.equal(r.isError, true, id)
    assert.match(textOf(r), /Unknown document id/, id)
    assert.doesNotMatch(textOf(r), /root:|"name"/, id) // no file content leaked
  }
  await close()
})

test('read_document: offset past the end is an error', async () => {
  const { client, close } = await connectedClient()
  const r = await client.callTool({ name: 'read_document', arguments: { id: 'README.md', offset: 999_999 } })
  assert.equal(r.isError, true)
  await close()
})

test('hard bounds on every argument reject abusive input', async () => {
  const { client, close } = await connectedClient()
  const bad: [string, Record<string, unknown>][] = [
    ['search_documents', { query: 'x'.repeat(501) }],
    ['search_documents', { query: '   ' }],
    ['search_documents', { query: 'ok', limit: 21 }],
    ['search_documents', { query: 'ok', limit: 0 }],
    ['search_documents', { query: 'ok', limit: 1.5 }],
    ['search_documents', { query: 42 }],
    ['list_documents', { limit: 201 }],
    ['list_documents', { offset: -1 }],
    ['read_document', { id: 'README.md', length: 20_001 }],
    ['read_document', { id: 'README.md', offset: -5 }],
    ['read_document', { id: '' }],
    ['read_document', { id: 'a'.repeat(501) }],
  ]
  for (const [name, args] of bad) assert.ok(await rejected(client.callTool({ name, arguments: args })), `${name} ${JSON.stringify(args).slice(0, 60)}`)
  await close()
})

test('resources: documents can be listed and read; unknown or traversal URIs fail', async () => {
  const { client, close } = await connectedClient()
  const { resources } = await client.listResources()
  assert.deepEqual(resources.map((r) => r.uri).sort(), ['docs://README.md', 'docs://guias.txt', 'docs://guides/setup.md'])
  const read = await client.readResource({ uri: 'docs://guides/setup.md' })
  assert.match((read.contents[0] as { text: string }).text, /default port is 8080/)
  for (const uri of ['docs://nope.md', 'docs://../../etc/passwd', 'docs://%2e%2e/%2e%2e/etc/passwd']) {
    await assert.rejects(client.readResource({ uri }), `${uri} should be rejected`)
  }
  await close()
})

test('tool descriptions warn that returned text is untrusted (prompt-injection note)', async () => {
  const { client, close } = await connectedClient()
  const { tools } = await client.listTools()
  for (const t of tools) assert.match(t.description ?? '', /untrusted/, t.name)
  await close()
})
