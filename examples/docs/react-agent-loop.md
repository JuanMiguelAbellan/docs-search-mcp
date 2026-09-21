# react-agent-loop

Minimal, dependency-free [ReAct](https://arxiv.org/abs/2210.03629) (Reason + Act) agent loop for any chat-completion client. Describe your tools, hand the loop a question, and it drives the reason → call tool → observe → repeat cycle until the model gives a final answer.

```bash
npm install react-agent-loop
```

## Why

I built this while giving an [Ollama](https://ollama.com)-backed CLI agent tool use. Ollama's native `tools` parameter (`/api/chat`) hung indefinitely with `qwen2.5:3b` — confirmed in isolation: the exact same model without `tools` responded in seconds, adding `tools` never returned even after 3+ minutes. Rather than depend on a provider's native function-calling support being available and working, this implements the technique that predates it: the model is told about its tools in plain text and asked to request one as JSON, you run it and hand back the result, and the model decides what to do next. It works with any model that can hold a conversation and follow an instruction to emit JSON, regardless of whether the provider has "real" tool-calling support.

## Usage

```ts
import { runReActAgent, createOllamaClient, Tool } from 'react-agent-loop'

const weatherTool: Tool = {
  name: 'weather',
  description: 'Gets the current weather for a city',
  parameters: '{"city": string}',
  async run({ city }) {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3&m`)
    return (await res.text()).trim()
  },
}

const client = createOllamaClient({ host: 'http://localhost:11434', model: 'qwen2.5:3b' })

const answer = await runReActAgent('What is the weather in Madrid?', [weatherTool], client, {
  onStep: (step) => console.log(step), // optional: observe each tool call/result as it happens
})

console.log(answer)
```

`createOllamaClient` is a convenience for the common case, but `runReActAgent` works with **any** `ChatClient` — anything with a `chat(messages) => Promise<string>` method, so it's trivial to point at OpenAI, Anthropic, or your own wrapper instead:

```ts
const client = { chat: async (messages) => (await myProvider.complete(messages)).text }
```

## API

- **`runReActAgent(question, tools, client, options?)`** — runs the loop, returns the final answer as a string.
  - `options.maxIterations` (default `6`) — safety cap on model round-trips.
  - `options.onStep` — callback fired on every `tool_call`, `tool_result`, and `tool_error`, useful for logging/debugging what the agent is doing.
- **`Tool`** — `{ name, description, parameters, run(params) }`. `parameters` is a human-readable schema shown to the model in the prompt (not a strict JSON Schema — smaller models tend to follow a plain-English example just as well, with less prompt overhead).
- **`extractJson(text)`** — the JSON extraction used internally; exported because it's independently useful (tolerates markdown fences and a model appending extra text/another JSON object after the one you asked for — it just takes the first complete object).
- **`buildSystemPrompt(tools)`** — the prompt-construction logic, exported in case you want to customize it.

## Design notes

- **No native tool-calling dependency.** This is the whole point — see "Why" above.
- **One tool call per turn, enforced in the prompt.** Smaller models will sometimes emit two JSON objects back-to-back when asked for one; `extractJson` only ever acts on the first, and the loop nudges the model to continue with the next tool on its following turn rather than trying to parse a multi-action response.
- **Tool failures don't crash the run.** A failing tool's error message is fed back to the model as an observation, same as a successful result — the model decides how to recover.
- **Zero runtime dependencies.** `createOllamaClient` uses Node's core `http`/`https` (not `fetch`) specifically to avoid `undici`'s default headers timeout, which is too aggressive for slower local models.

## Tests

```bash
npm test
```

## License

MIT
