# Health Info Assistant — POC

A physician-led, consumer-facing health **information** chatbot. Answers are grounded
(RAG) in trusted public-domain content from **MedlinePlus** (NIH/NLM). Built to run
entirely on free tiers — your only paid dependency is the OpenAI API.

> Educational information only — **not medical advice**, not a diagnosis, and not a
> substitute for a licensed clinician.

## Architecture (a16z "in-context learning" pattern)

```
User question
  → OpenAI embedding  (text-embedding-3-small)
  → pgvector similarity search over the MedlinePlus corpus (Neon Postgres)
  → safety gate (emergency/self-harm → crisis guidance, never the LLM)
  → grounded prompt → OpenAI chat (gpt-4o-mini, streamed)
  → answer + cited sources, conversation logged
```

Everything (relational data, vectors, logs) lives in **one Neon Postgres** via
`pgvector` — no separate vector DB, no Redis, no queues. That keeps it deployable
on the **Vercel free tier** at **zero cost beyond OpenAI usage**.

## PHI / compliance posture (POC)

Consumer AI tools (incl. OpenAI) are not HIPAA-compliant and must not process
unredacted PHI; doing so would make you a Business Associate requiring a BAA. So this
POC is designed to **avoid PHI entirely**:

- Anonymous sessions only — a random opaque cookie id, no name/email/PII columns.
- Educational framing, persistent disclaimer, no diagnosis/prescription.
- Emergency/self-harm detection routes to 911/988 instead of the model.

Moving POC → pilot with real PHI later means: BAAs with model/cloud vendors,
encryption + access controls, and retention rules. Scope that separately.

## Shared database safety

This connects to a **shared** Neon DB. All objects are namespaced with the prefix
`haic_` (see `lib/constants.json`). Migrations are **additive only** —
`CREATE ... IF NOT EXISTS`, never `DROP`/`DELETE`.

## Setup

```bash
npm install
cp .env.example .env.local      # fill in DATABASE_URL + OPENAI_API_KEY
npm run db:migrate              # creates haic_* tables + pgvector (idempotent)
npm run db:ingest               # pulls MedlinePlus topics → chunks → embeds (one-time, local)
npm run dev                     # http://localhost:3000
```

`db:ingest` runs locally (not on Vercel) so the deploy stays tiny; it's idempotent and
skips topics already loaded. Edit the `TOPICS` list in `scripts/ingest.mjs` to grow the
corpus.

## Deploy (Vercel free tier)

1. Push to GitHub, import into Vercel.
2. Set `DATABASE_URL` and `OPENAI_API_KEY` env vars.
3. Deploy. The chat route is a standard Node serverless function (`maxDuration = 30`),
   well within Hobby limits.

## Data model (`haic_` prefix)

| Table | Purpose |
|-------|---------|
| `conversation` | Anonymous session (opaque `anon_id`, no PII) |
| `message` | Each turn + `model`, `safety_flag` for review |
| `kb_document` | A MedlinePlus topic (title, url, source) |
| `kb_chunk` | Chunked text + `vector(1536)` embedding |
| `message_citation` | Which chunks grounded each answer (traceability) |

## Attribution

Health information from [MedlinePlus.gov](https://medlineplus.gov) (U.S. National
Library of Medicine, NIH), used per its [terms](https://medlineplus.gov/about/using/usingcontent/).
