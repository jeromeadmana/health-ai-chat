// Additive, idempotent schema migration for a SHARED Neon database.
// - Every object is namespaced with the table prefix from lib/constants.json.
// - Uses only CREATE ... IF NOT EXISTS. It NEVER drops or deletes anything.
//
// Run: node --env-file=.env.local scripts/migrate.mjs
import { neon } from "@neondatabase/serverless";
import constants from "../lib/constants.json" with { type: "json" };

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local");
  process.exit(1);
}

const sql = neon(url);
const P = constants.tablePrefix;
const DIM = constants.embeddingDimensions;

const statements = [
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE EXTENSION IF NOT EXISTS pgcrypto`,

  `CREATE TABLE IF NOT EXISTS ${P}conversation (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     anon_id text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS ${P}kb_document (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     topic text,
     title text NOT NULL,
     url text,
     source text NOT NULL DEFAULT 'MedlinePlus',
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS ${P}kb_chunk (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     document_id uuid NOT NULL REFERENCES ${P}kb_document(id),
     chunk_index int NOT NULL,
     content text NOT NULL,
     embedding vector(${DIM}),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS ${P}message (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     conversation_id uuid NOT NULL REFERENCES ${P}conversation(id),
     role text NOT NULL,
     content text NOT NULL,
     model text,
     safety_flag text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS ${P}message_citation (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     message_id uuid NOT NULL REFERENCES ${P}message(id),
     chunk_id uuid NOT NULL REFERENCES ${P}kb_chunk(id),
     similarity real
   )`,

  `CREATE INDEX IF NOT EXISTS ${P}kb_chunk_doc_idx ON ${P}kb_chunk(document_id)`,
];

for (const stmt of statements) {
  const label = stmt.split("\n")[0].trim();
  await sql.query(stmt);
  console.log("✓", label);
}

console.log(`\nDone. All objects use prefix "${P}". Nothing was dropped.`);
