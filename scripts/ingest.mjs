// One-time, local-only corpus ingestion. Runs on YOUR machine, not on Vercel,
// so the serverless deploy stays tiny and within the free tier.
//
// Source: MedlinePlus health-topics web service (NIH/NLM) — free, no API key,
// no registration. Per NLM terms we attribute MedlinePlus in the UI and stay
// well under the 85 req/min limit.
//
// Idempotent + additive: skips any topic already present (we never delete on
// the shared DB), so re-running won't create duplicates.
//
// Run: node --env-file=.env.local scripts/ingest.mjs
import { neon } from "@neondatabase/serverless";
import { XMLParser } from "fast-xml-parser";
import OpenAI from "openai";
import constants from "../lib/constants.json" with { type: "json" };

const url = process.env.DATABASE_URL;
const openaiKey = process.env.OPENAI_API_KEY;
if (!url || !openaiKey) {
  console.error("DATABASE_URL and OPENAI_API_KEY must be set in .env.local");
  process.exit(1);
}

const sql = neon(url);
const openai = new OpenAI({ apiKey: openaiKey });
const P = constants.tablePrefix;

// Common consumer health topics for the POC corpus.
const TOPICS = [
  "Diabetes",
  "High Blood Pressure",
  "High Cholesterol",
  "Asthma",
  "Heart Disease",
  "Depression",
  "Anxiety",
  "Migraine",
  "Back Pain",
  "Common Cold",
  "Influenza",
  "Allergy",
  "Obesity",
  "Sleep Disorders",
  "Arthritis",
  "Heartburn",
  "Sore Throat",
  "Vitamin D",
  "Healthy Sleep",
  "Exercise and Physical Fitness",
  "Nutrition",
  "Stress",
  "Dehydration",
  "Thyroid Diseases",
  "Osteoporosis",
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function stripHtml(html) {
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function chunkText(text, size = 900, overlap = 150) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + size));
    i += size - overlap;
  }
  return chunks.filter((c) => c.trim().length > 40);
}

async function fetchTopic(term) {
  const endpoint =
    "https://wsearch.nlm.nih.gov/ws/query?db=healthTopics&retmax=1&term=" +
    encodeURIComponent(term);
  const res = await fetch(endpoint, { headers: { Accept: "application/xml" } });
  if (!res.ok) throw new Error(`MedlinePlus HTTP ${res.status}`);
  const xml = await res.text();
  const doc = parser.parse(xml);

  const list = doc?.nlmSearchResult?.list?.document;
  const first = Array.isArray(list) ? list[0] : list;
  if (!first) return null;

  const contents = Array.isArray(first.content) ? first.content : [first.content];
  const byName = {};
  for (const c of contents) {
    if (c && c["@_name"]) byName[c["@_name"]] = c["#text"] ?? "";
  }
  const title = stripHtml(byName["title"] || term);
  const summary = stripHtml(byName["FullSummary"] || byName["snippet"] || "");
  const pageUrl = first["@_url"] || null;
  if (!summary) return null;
  return { title, summary, url: pageUrl };
}

async function existing(topic) {
  const rows = await sql.query(
    `SELECT 1 FROM ${P}kb_document WHERE topic = $1 LIMIT 1`,
    [topic]
  );
  const arr = Array.isArray(rows) ? rows : rows.rows;
  return arr.length > 0;
}

let docCount = 0;
let chunkCount = 0;

for (const topic of TOPICS) {
  try {
    if (await existing(topic)) {
      console.log(`• skip "${topic}" (already ingested)`);
      continue;
    }
    const data = await fetchTopic(topic);
    if (!data) {
      console.log(`• no content for "${topic}"`);
      continue;
    }

    const docRows = await sql.query(
      `INSERT INTO ${P}kb_document (topic, title, url, source) VALUES ($1, $2, $3, 'MedlinePlus') RETURNING id`,
      [topic, data.title, data.url]
    );
    const docId = (Array.isArray(docRows) ? docRows : docRows.rows)[0].id;

    const chunks = chunkText(data.summary);
    const emb = await openai.embeddings.create({
      model: constants.embeddingModel,
      input: chunks,
    });

    for (let i = 0; i < chunks.length; i++) {
      const vec = `[${emb.data[i].embedding.join(",")}]`;
      await sql.query(
        `INSERT INTO ${P}kb_chunk (document_id, chunk_index, content, embedding) VALUES ($1, $2, $3, $4::vector)`,
        [docId, i, chunks[i], vec]
      );
      chunkCount++;
    }
    docCount++;
    console.log(`✓ "${topic}" → ${chunks.length} chunks`);
    await new Promise((r) => setTimeout(r, 200)); // gentle on the NLM service
  } catch (err) {
    console.error(`✗ "${topic}":`, err.message);
  }
}

console.log(`\nIngested ${docCount} new documents, ${chunkCount} chunks.`);
