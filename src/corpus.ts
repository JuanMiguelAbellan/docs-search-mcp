import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { extractTitle } from './text.js'
import type { Doc } from './types.js'

export interface LoadOptions {
  extensions?: string[]
  maxFileBytes?: number
  maxFiles?: number
}

export interface Skipped {
  path: string
  reason: string
}

// Locale-independent order: ids (and so `offset` paging) must be identical on every machine.
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const DEFAULTS = { extensions: ['.md', '.markdown', '.txt'], maxFileBytes: 2_000_000, maxFiles: 5000 }

/** Load text documents from `root`, read-only. The served folder is a security boundary: files (or symlinks)
 *  that resolve outside it are skipped, and after loading, tools only ever look documents up by id in memory —
 *  no path a client sends is ever joined onto the filesystem. */
export async function loadDocuments(root: string, options: LoadOptions = {}): Promise<{ docs: Doc[]; skipped: Skipped[] }> {
  const { extensions, maxFileBytes, maxFiles } = { ...DEFAULTS, ...options }
  const rootReal = await realpath(root)
  const docs: Doc[] = []
  const skipped: Skipped[] = []
  const seen = new Set<string>() // real paths already handled: a symlink to a file must not load it twice (ids are real paths)

  const inside = (p: string) => p === rootReal || p.startsWith(rootReal + sep)
  const rel = (p: string) => relative(rootReal, p).split(sep).join('/')

  async function walk(dir: string): Promise<void> {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => byName(a.name, b.name))
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const full = join(dir, e.name)
      let real: string
      try {
        real = await realpath(full)
      } catch {
        skipped.push({ path: rel(full), reason: 'unresolvable (broken symlink?)' })
        continue
      }
      if (!inside(real)) {
        skipped.push({ path: rel(full), reason: 'resolves outside the served folder' })
        continue
      }
      if (seen.has(real)) continue
      seen.add(real)
      const info = await stat(real)
      if (info.isDirectory()) {
        await walk(real)
      } else if (info.isFile()) {
        if (!extensions.some((x) => e.name.toLowerCase().endsWith(x))) continue
        if (docs.length >= maxFiles) {
          skipped.push({ path: rel(real), reason: `more than ${maxFiles} files` })
          continue
        }
        if (info.size > maxFileBytes) {
          skipped.push({ path: rel(real), reason: `larger than ${maxFileBytes} bytes` })
          continue
        }
        const text = (await readFile(real, 'utf8')).replace(/\r\n/g, '\n')
        if (text.includes('\u0000')) {
          skipped.push({ path: rel(real), reason: 'binary content' })
          continue
        }
        const id = rel(real)
        docs.push({ id, title: extractTitle(text, id), text })
      }
    }
  }

  await walk(rootReal)
  docs.sort((a, b) => byName(a.id, b.id))
  return { docs, skipped }
}
