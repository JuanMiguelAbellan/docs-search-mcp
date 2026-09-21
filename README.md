# docs-search-mcp

A small, **read-only [MCP](https://modelcontextprotocol.io) server** that lets an AI client (Claude Desktop, Claude Code,
your own agent…) search and read a folder of Markdown/text documents.

It has three tools and one resource type, hybrid search (BM25 + optional local embeddings), and — the part I cared about
most — it treats the model calling it as **untrusted**.

```
$ npm run demo          # a 3B local model answering questions about ./examples/docs through this server
Q: What is the price of the Pro subscription plan?
  → search_documents({"query":"What is the price of the Pro subscription plan?","limit":5})
    ok: No passages matched "What is the price of the Pro subscription plan?".…
  → list_documents({"limit":5})
A: No passages matched … and I couldn't find the information in the provided documents.
```

## Tools

| tool | what it does | bounds |
| --- | --- | --- |
| `search_documents` | best-matching passages for a natural-language query, with document id, title and character range | query 1–500 chars, limit 1–20 |
| `read_document` | read a document by id, in pages (`offset` / `length`, returns `nextOffset`) | length ≤ 20 000 chars |
| `list_documents` | ids, titles and sizes, paged | limit ≤ 200 |
| resource `docs://{id}` | the full text of one document (for clients that attach resources) | — |

All tools carry `readOnlyHint: true` / `destructiveHint: false` annotations, declare an `outputSchema`, and return both
human-readable text and `structuredContent`. Errors are returned as tool errors the model can act on
(`Unknown document id "setup.md". Did you mean: guides/setup.md?`), not as crashes.

## Use it

Requires Node 20+.

```bash
git clone https://github.com/JuanMiguelAbellan/docs-search-mcp && cd docs-search-mcp
npm install && npm run build
node dist/cli.js ./path/to/your/docs                       # BM25 search, no other dependencies
node dist/cli.js ./docs --ollama-model bge-m3 --cache .emb.json   # hybrid: + local embeddings via Ollama
```

Options: `--ollama-model`, `--ollama-host` (default `http://127.0.0.1:11434`), `--cache <file>` (remember embeddings between
runs), `--chunk <chars>` (passage size, default 1000).

Claude Desktop / Claude Code (`claude mcp add docs -- node /abs/path/dist/cli.js /abs/path/to/docs`), or in a JSON config:

```json
{ "mcpServers": { "docs": { "command": "node", "args": ["/abs/path/docs-search-mcp/dist/cli.js", "/abs/path/to/docs"] } } }
```

## Security model

Tool arguments are written by an LLM, which can be manipulated by whatever text it has read. So:

- **No argument is ever used as a file path.** Documents are loaded once at startup and looked up *by id in memory*.
  `read_document({id: "../../etc/passwd"})` is just an unknown id. (Tested with `..`, absolute, Windows and NUL-byte ids,
  and with `docs://` URIs including percent-encoded traversal.)
- **The served folder is a boundary.** At load time every entry is `realpath`-resolved; files and directories (including
  symlinks) that resolve outside the folder are skipped and reported on stderr. Dot-directories and `node_modules` are skipped;
  files over 2 MB, binary files and anything past 5000 files are skipped too.
- **Every argument has a hard schema bound** (see the table), validated by zod before the handler runs.
- **Read-only by construction:** there is no write, delete or execute tool, and no network access except the optional
  call to your own Ollama.
- **Returned text is untrusted data.** A document can contain "ignore previous instructions…". The server can't stop a
  client from obeying it, so each tool description tells the model not to, and the README of any client you build should
  treat tool output as data. This is a mitigation, not a guarantee.
- **stdout is the protocol channel.** Logging goes to stderr only (a stray `console.log` would corrupt the JSON-RPC stream);
  an end-to-end test spawns the real CLI and checks this.

## How search works

Documents are cut into passages of at most 1000 characters at paragraph boundaries (long paragraphs are split at whitespace),
each remembering its exact character range in the source. BM25 (k1 = 1.5, b = 0.75) runs over accent-folded, stopword-filtered,
6-character-prefix-stemmed tokens (English and Spanish stopwords). With `--ollama-model`, cosine similarity over embeddings is
computed too and the two rankings are merged with Reciprocal Rank Fusion.

These choices follow what I measured in [rag-eval](https://github.com/JuanMiguelAbellan/rag-eval) on Spanish text: paragraph chunks beat fixed windows at this
size, a multilingual embedding model (bge-m3) beat `nomic-embed-text`, and BM25 + dense fusion was best. That study used a
different corpus and code path; this server was not re-evaluated on it.

## Demo, and what it shows honestly

`examples/agent.ts` runs a ReAct-style loop (the same JSON-action protocol as my
[react-agent-loop](https://github.com/JuanMiguelAbellan/react-agent-loop)) with `qwen2.5:3b` on Ollama. Tool descriptions and schemas in the prompt are generated
from what the server advertises over stdio. The unedited run is in [`examples/transcript.txt`](examples/transcript.txt) — I
did not reword questions after seeing the answers. Checked against the documents:

1. *Which change improved retrieval most in rag-eval, and what MRR did the best setup reach?* — the model got **0.947 right**
   but named "paragraph chunking" as the biggest change; the docs say the embedding model / BM25 (≈ +0.20 vs. +0.08). **Half wrong.**
2. *What happens in react-agent-loop when the model answers in prose?* — the retrieved passage is the right document, but its
   README doesn't say anything about prose, so the model's answer is filled in from general knowledge. **Unsupported by the documents.**
3. *Price of the Pro plan?* (not in any document) — searched, found nothing, said so. **Correct.**

The server did its job in all three (right documents, right passages, clean error handling). The mistakes are a 3B model
reasoning over retrieved text — exactly what a retrieval tool cannot fix.

## Bugs the tests found in my own code

- **Same file loaded twice.** A symlink *inside* the folder resolves to the same real path as its target, and ids are real
  paths, so the file appeared twice under one id. My first test asserted `docs.length >= 1` and hid it; tightening it to the
  exact list exposed the bug.
- **Document order depended on the machine's locale.** `localeCompare` sorts differently per locale, so `offset` paging could
  return different pages on different machines. Ordering is now a plain code-unit comparison.

## Tests

`npm test` — 30 tests, no Ollama needed (a fake embedder stands in): chunking invariants, loader security (symlink escape,
binary/oversized/excess files, duplicate symlinks, locale-independent ordering), BM25 and hybrid search, the full MCP
protocol through an in-memory client/server pair (schemas, bounds, pagination, traversal ids, resources), and an end-to-end
test that spawns the real CLI over stdio.

## Limitations

- **Index is built at startup, in memory.** New or edited files need a restart. Fine for hundreds of documents; not
  designed for very large corpora (dense search is a linear scan).
- Only `.md`, `.markdown` and `.txt`. No PDF, HTML or DOCX extraction.
- Prefix "stemming" is crude (works for English and Spanish inflection, wrong for other languages) and stopwords cover only
  English and Spanish.
- Embeddings need a local Ollama; there is no hosted-embedding option. The embedding cache is keyed by text and model only.
- Prompt-injection can only be mitigated, not prevented, at this layer (see above).
- Tested with the official TypeScript SDK client (1.30) and my own demo agent; **I have not tested it inside Claude Desktop or Claude Code** — the config snippets above follow their documented format but are untested.
- Not published to npm.

## Licence

MIT.
