/**
 * Demo: a small local LLM (Ollama) answers questions about ./examples/docs by calling this MCP server's tools.
 *
 *   ollama pull qwen2.5:3b
 *   npm run demo                      # runs the built-in questions
 *   npm run demo -- "your question"   # or your own
 *
 * The agent is a plain ReAct loop (same JSON-action protocol as my react-agent-loop project) — Ollama's native
 * tool-calling is unreliable with small models, so tools are described in the prompt instead. The point of the demo
 * is the MCP side: the tool list, the schemas and the calls all come from the server, over real stdio.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'

const HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434'
const MODEL = process.env.DEMO_MODEL ?? 'qwen2.5:3b'
const MAX_STEPS = 5
const DOCS = fileURLToPath(new URL('./docs', import.meta.url))
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

const DEFAULT_QUESTIONS = [
  'In the rag-eval project, which change improved retrieval the most, and what MRR did the best setup reach?',
  'What happens in react-agent-loop when the model answers in plain prose instead of JSON?',
  'What is the price of the Pro subscription plan?', // not in any document: the right answer is "I could not find it"
]

type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

async function chat(messages: Msg[]): Promise<string> {
  const res = await fetch(`${HOST}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, stream: false, messages, options: { temperature: 0 } }),
    signal: AbortSignal.timeout(300_000),
  })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return ((await res.json()) as { message?: { content?: string } }).message?.content ?? ''
}

/** First complete JSON object in the text (small models wrap it in prose or code fences). */
function firstJson(text: string): any {
  const start = text.indexOf('{')
  for (let depth = 0, i = start; start >= 0 && i < text.length; i++) {
    if (text[i] === '{') depth++
    if (text[i] === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1))
  }
  throw new Error('no JSON object')
}

async function main() {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', CLI, DOCS], stderr: 'inherit' })
  const client = new Client({ name: 'demo-agent', version: '0.1.0' })
  await client.connect(transport)

  const { tools } = await client.listTools()
  console.log(`# MCP server: ${client.getServerVersion()?.name} — tools discovered: ${tools.map((t) => t.name).join(', ')}`)
  console.log(`# model: ${MODEL}\n`)

  // The prompt is generated from what the server advertises: nothing about the tools is hard-coded here.
  const toolText = tools.map((t) => `- ${t.name}: ${t.description}\n  arguments (JSON Schema): ${JSON.stringify(t.inputSchema.properties)}`).join('\n')
  const system = `You answer questions using tools that search a folder of documents.
To call a tool reply with ONLY one JSON object: {"tool": "<name>", "params": {...}}
When you can answer, reply with ONLY: {"final_answer": "<answer>"}
Rules: base the answer only on tool results and mention the document id it came from. If the documents do not contain the answer, say so instead of guessing. One JSON object per message.

Tools:
${toolText}`

  const questions = process.argv.slice(2).length ? [process.argv.slice(2).join(' ')] : DEFAULT_QUESTIONS
  for (const question of questions) {
    console.log(`Q: ${question}`)
    const messages: Msg[] = [{ role: 'system', content: system }, { role: 'user', content: question }]
    let answer = '(no final answer within the step limit)'
    for (let step = 0; step < MAX_STEPS; step++) {
      const reply = await chat(messages)
      let action: any
      try {
        action = firstJson(reply)
      } catch {
        answer = reply.trim()
        break
      }
      if (typeof action.final_answer === 'string') {
        answer = action.final_answer
        break
      }
      messages.push({ role: 'assistant', content: reply })
      console.log(`  → ${action.tool}(${JSON.stringify(action.params ?? {})})`)
      const result = await client.callTool({ name: String(action.tool), arguments: action.params ?? {} }).catch((e: Error) => ({ isError: true, content: [{ type: 'text', text: e.message }] }))
      const text = (result.content as { text?: string }[]).map((c) => c.text ?? '').join('\n')
      console.log(`    ${result.isError ? 'error' : 'ok'}: ${text.replace(/\s+/g, ' ').slice(0, 110)}…`)
      messages.push({ role: 'user', content: `Result of ${action.tool}${result.isError ? ' (error)' : ''}:\n${text}\n\nAnswer the original question if you can: "${question}"` })
    }
    console.log(`A: ${answer}\n`)
  }
  await client.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
