import OpenAI from "openai";
import { EMBEDDING_MODEL } from "@/lib/config";

let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

export async function embedQuery(text: string): Promise<string> {
  const res = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  // pgvector literal form: "[0.1,0.2,...]"
  return `[${res.data[0].embedding.join(",")}]`;
}
