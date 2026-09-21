export function foldAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Function words in English and Spanish, so BM25 is not dominated by them (the served docs can be in either).
const STOPWORDS = new Set(
  (
    'a about al algo all also an and are as at be been but by can con contra cual de del desde do does donde el ella ello en entre es esa ese eso esta este esto for from fue ha han has have how i if in into is it its la las le les lo los mas me mi muy ni no nos not o of on or para pero por porque que quien se sea segun ser si sin sobre son su sus tambien than that the their then there these they this to un una uno unos was were what when where which who why will with y ya you'
  ).split(' '),
)

export function tokenize(text: string, stemPrefix = 6): string[] {
  const out: string[] = []
  for (const raw of foldAccents(text).toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue
    out.push(stemPrefix > 0 ? raw.slice(0, stemPrefix) : raw)
  }
  return out
}

/** First Markdown heading, else the first non-empty line, else the fallback. */
export function extractTitle(text: string, fallback: string): string {
  const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(text)
  if (heading) return heading[1]!.trim().slice(0, 120)
  const first = text.split('\n').find((l) => l.trim())
  return (first ?? fallback).trim().slice(0, 120)
}
