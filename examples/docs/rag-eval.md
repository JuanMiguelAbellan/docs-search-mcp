# rag-eval

Measure a RAG pipeline instead of guessing about it.

I built this to answer a concrete question about my own project, [IADocuments](https://github.com/JuanMiguelAbellan/Proyecto-2-DAW) (a
self-hosted document assistant): its retrieval uses `nomic-embed-text` on **Spanish** PDFs, chunked in fixed 1000-character
windows. I had picked those settings by feel. Were they any good?

`rag-eval` scores retrieval and answer quality on a small hand-checked gold set, over any chunking strategy and any retriever,
with confidence intervals — and it runs locally against [Ollama](https://ollama.com), no API keys.

## What I found

On 110 answerable Spanish questions over 12 Wikipedia articles, comparing against IADocuments' production configuration
(fixed 1000/150 windows, `nomic-embed-text` without task prefixes, top-5):

| change (one at a time) | MRR | Δ MRR vs. baseline (95% CI) | recall@5 |
| --- | --- | --- | --- |
| **baseline — what IADocuments runs** | **0.685** | — | **81.8%** |
| add nomic's task prefixes (`search_query:` / `search_document:`) | 0.743 | +0.058 [+0.020, +0.099] | 90.0% |
| paragraph chunking instead of fixed windows | 0.761 | +0.076 [+0.013, +0.142] | 88.2% |
| swap nomic-embed-text for the multilingual bge-m3 | 0.878 | +0.193 [+0.136, +0.256] | 97.3% |
| BM25 only, no embeddings at all | 0.885 | +0.200 [+0.133, +0.270] | 97.7% |
| **everything: paragraph chunks + hybrid BM25 + bge-m3** | **0.947** | **+0.262 [+0.191, +0.338]** | **98.6%** |

- **The embedding model was the main problem**, not the chunking. `nomic-embed-text` is English-centric: on Spanish text it
  loses to plain keyword search (BM25), which needs no model at all.
- IADocuments was also **not using nomic's task prefixes**, which its authors specify for retrieval. Free +0.06 MRR.
- At 1000 characters, paragraph chunking beat fixed windows with **every** retriever (at 500 characters the picture is mixed),
  and smaller chunks were never clearly better and usually worse (300-char windows lost ~0.05 MRR with bge-m3 and BM25).
- Fusing BM25 with a dense retriever (Reciprocal Rank Fusion) gave the best result, but only by a small margin over either
  alone once the embedding model was good.

The full grid (5 chunkers × 6 retrievers) is in [`results/report.md`](results/report.md).

## Does better retrieval mean better answers?

Same questions, answered by `qwen2.5:3b` (the model IADocuments runs), top-5 passages, scored without an LLM judge:

| condition | correct answers (95% CI) | wrongly abstained | invented an answer to an unanswerable question |
| --- | --- | --- | --- |
| closed-book (no documents) | 17.3% (10.0–24.5) | — | — |
| RAG with IADocuments' retrieval | 81.8% (73.6–88.2) | 14 / 110 | 1 / 18 |
| RAG with the best retrieval above | **91.8%** (86.4–96.4) | 3 / 110 | 1 / 18 |
| oracle: the gold paragraph as context | 97.3% (93.6–100) | 0 / 110 | — |

- Without the documents the model gets 17% of these questions right, so retrieval is doing real work.
- Better retrieval translates into better answers: **+10.0 points** (paired 95% CI [2.7, 19.1]; 17 questions fixed, 6 broken).
- The oracle row is the ceiling for this model. Retrieval was the bottleneck: the gap between IADocuments' setup and the
  ceiling is ~15 points, and the best setup closes about two thirds of it.
- With good context the 3B model almost never invents an answer when the corpus has none (1 of 18) — but 18 questions is
  a small sample.
- The best setup also sends fewer prompt tokens (≈1200 vs ≈1470) and answers faster.


## How it works

```
corpus/*.txt ──► chunkers ──► retrievers ──► metrics ──► results/*.json ──► report.md
                 fixed-N/overlap    BM25                  recall@k, MRR,
                 paragraph-N        dense (Ollama)        nDCG@k, paired
                                    hybrid (RRF)          bootstrap CIs
questions.jsonl ─► gold quotes ────────────► relevance ───┘
```

**Gold labels are quotes, not chunk ids.** Every answerable question points at a verbatim quote in a document. A chunk
counts as relevant if it contains at least half of the quote or 150 characters of it, whichever is smaller. That makes
relevance independent of how the text was chunked, so different chunkers can be compared fairly — the usual pitfall when
labels are tied to one chunking. `npm run validate` fails if any quote is missing or ambiguous.

**Answer scoring uses no LLM judge.** Small local models are unreliable judges. Instead each question lists *key facts*
(groups of accepted alternatives, matched accent/case-insensitively), and the model is told to answer
`NO_ENCONTRADO` when the context does not contain the answer. That gives two deterministic numbers: did a correct answer
contain the facts, and did it abstain on the 18 questions that have no answer in the corpus?

**Retrievers:** BM25 (own implementation, accent folding + Spanish stopwords + 6-char prefix stemming), dense cosine
similarity over Ollama embeddings (cached on disk), and hybrid via Reciprocal Rank Fusion.

**Statistics:** every difference is a paired bootstrap over questions (2000 resamples, seeded), so "better" means the 95%
interval excludes zero — not just a bigger number on a small set.

## Run it

Requires Node 20+ and a running Ollama with the models used here:

```bash
ollama pull nomic-embed-text && ollama pull bge-m3 && ollama pull qwen2.5:3b
npm install
npm test                # 43 unit tests, no Ollama needed (a fake HTTP server stands in for it)
npm run validate        # check every gold quote exists verbatim in the corpus
npm run retrieval       # 5 chunkers × 6 retrievers  → results/retrieval.json
npm run generation      # closed-book / RAG / oracle → results/generation.json
npm run report          # → results/report.md
```

Options: `npm run retrieval -- --chunkers fixed-1000-150,para-1000 --retrievers bm25,bge-m3`,
`npm run generation -- --model qwen2.5:3b`. Point `OLLAMA_HOST` at a remote instance if needed. Embeddings are cached in
`.cache/`, so re-runs only pay for what changed.

To evaluate **your own** pipeline: put `.txt` files and a `manifest.json` in `corpus/`, write questions in
`dataset/questions.jsonl` (see the format in the file header), and add a `RetrieverSpec` in `src/experiments.ts`.

## Limitations (read before trusting the numbers)

- **Small, single-annotator gold set.** 110 questions, written by me with the help of an AI assistant (Claude) reading the
  articles, and validated programmatically — every gold quote must exist verbatim in the corpus. No independent second
  annotator, so there is no inter-annotator agreement figure.
- **Lexical bias.** Questions were written while reading the source text, so many reuse its wording, which favours keyword
  search. I tagged them (`lexical` vs `paraphrase`) and report both, but the "paraphrase" questions are only lightly
  reworded — this set understates how much a real user's phrasing would hurt BM25. Treat BM25's strong showing as an upper bound.
- **One domain.** Spanish Wikipedia prose. Scanned PDFs, tables, code or very long documents may rank the strategies differently.
- **Corpus truncated** to ~16,000 characters per article (12 articles, 263 paragraph chunks). Retrieval gets harder as the corpus grows.
- **Model files.** Models ran from GGUF files on Hugging Face rather than the Ollama registry (which was unreachable from my
  network): `nomic-embed-text-v1.5` f16 (same weights as Ollama's), `Qwen2.5-3B-Instruct` Q4_K_M (Ollama's default quantisation),
  and `bge-m3` at Q8_0 (Ollama's is f16 — a slight quantisation difference).
- The generation prompt is mine (it includes the `NO_ENCONTRADO` abstention instruction), not IADocuments' production prompt, and answers
  were generated once per condition at temperature 0 — no run-to-run variance is reported.
- Retrieval quality is measured here; **end-to-end user satisfaction is not.**

## Data & licences

Code, questions and results: MIT. The 12 texts in `corpus/` are Spanish Wikipedia extracts under **CC BY-SA 4.0** — see
[`corpus/ATTRIBUTION.md`](corpus/ATTRIBUTION.md).
