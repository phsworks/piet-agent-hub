import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", EMBEDDING_MODEL) as Promise<FeatureExtractionPipeline>;
  }
  return extractorPromise;
}

export async function embed(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

const EMBED_BATCH = 32;

export async function embedMany(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    out.push(...(output.tolist() as number[][]));
  }
  return out;
}
