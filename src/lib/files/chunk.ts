// all-MiniLM-L6-v2 truncates at 256 tokens (~1000 chars), so chunks stay below that.
const CHUNK_CHARS = 900;
const OVERLAP_CHARS = 150;

/** Splits text on paragraph/line boundaries into overlapping chunks. */
export function chunkText(text: string): string[] {
  const pieces = text
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => hardSplit(p));

  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 1 > CHUNK_CHARS) {
      chunks.push(current);
      current = current.slice(-OVERLAP_CHARS);
    }
    current = current ? `${current}\n${piece}` : piece;
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

function hardSplit(piece: string) {
  if (piece.length <= CHUNK_CHARS) return [piece];
  const out: string[] = [];
  for (let i = 0; i < piece.length; i += CHUNK_CHARS - OVERLAP_CHARS) {
    out.push(piece.slice(i, i + CHUNK_CHARS));
  }
  return out;
}
