import constants from "@/lib/constants.json";

// Single source of truth (shared with the .mjs scripts via lib/constants.json).
export const TABLE_PREFIX = constants.tablePrefix;
export const EMBEDDING_MODEL = constants.embeddingModel;
export const EMBEDDING_DIMENSIONS = constants.embeddingDimensions;
export const CHAT_MODEL = constants.chatModel;
export const RETRIEVAL_TOP_K = constants.retrievalTopK;

// All tables are namespaced with TABLE_PREFIX because this runs on a SHARED
// Neon database. Nothing here ever drops or deletes pre-existing objects.
export const T = {
  conversation: `${TABLE_PREFIX}conversation`,
  message: `${TABLE_PREFIX}message`,
  document: `${TABLE_PREFIX}kb_document`,
  chunk: `${TABLE_PREFIX}kb_chunk`,
  citation: `${TABLE_PREFIX}message_citation`,
} as const;
