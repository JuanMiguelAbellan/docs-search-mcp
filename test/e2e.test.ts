import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { FIXTURES, textOf } from './helpers.js'

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

// Real subprocess, real stdio framing: proves nothing but JSON-RPC ever reaches stdout.
test('the real CLI speaks MCP over stdio and logs only to stderr', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', CLI, FIXTURES], stderr: 'pipe' })
  let stderr = ''
  const client = new Client({ name: 'e2e', version: '0.0.0' })
  await client.connect(transport)
  transport.stderr?.on('data', (d) => (stderr += d))
  try {
    assert.equal(client.getServerVersion()?.name, 'docs-search-mcp')
    const r = await client.callTool({ name: 'search_documents', arguments: { query: 'cafetera vinagre' } })
    assert.match(textOf(r), /guias\.txt/)
  } finally {
    await client.close()
  }
  await new Promise((r) => setTimeout(r, 50))
  assert.match(stderr, /serving 3 documents/)
})

test('the CLI exits non-zero with a clear message on a missing folder or an empty one', async () => {
  const run = (arg: string) =>
    new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve) => {
      const p = spawn(process.execPath, ['--import', 'tsx', CLI, arg])
      let stderr = ''
      let stdout = ''
      p.stderr.on('data', (d) => (stderr += d))
      p.stdout.on('data', (d) => (stdout += d))
      p.on('close', (code) => resolve({ code, stderr, stdout }))
    })
  const missing = await run('/definitely/not/here')
  assert.equal(missing.code, 1)
  assert.match(missing.stderr, /fatal:/)
  assert.equal(missing.stdout, '')
  const empty = await run(fileURLToPath(new URL('../src', import.meta.url))) // no .md/.txt in src
  assert.equal(empty.code, 1)
  assert.match(empty.stderr, /no \.md\/\.markdown\/\.txt documents/)
})
