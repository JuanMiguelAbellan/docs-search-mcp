export interface Doc {
  /** Path relative to the served folder, with forward slashes. This is the only identifier tools accept. */
  id: string
  title: string
  text: string
}

export interface Chunk {
  docId: string
  index: number
  start: number
  end: number
  text: string
}

export interface Hit {
  docId: string
  title: string
  start: number
  end: number
  score: number
  text: string
}
