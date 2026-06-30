import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { getOpenAI, embedQuery } from "@/lib/openai";
import { CHAT_MODEL, RETRIEVAL_TOP_K, T } from "@/lib/config";
import { detectEmergency, EMERGENCY_MESSAGE } from "@/lib/safety";
import {
  SYSTEM_PROMPT,
  buildContextBlock,
  type RetrievedChunk,
} from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 30; // within Vercel Hobby (free tier) limits

const ANON_COOKIE = "haic_anon";

function sourcesHeader(sources: { title: string; url: string | null }[]): string {
  // base64 so arbitrary titles/urls are always header-safe
  return Buffer.from(JSON.stringify(sources), "utf8").toString("base64");
}

export async function POST(req: Request) {
  let message: string;
  let conversationId: string | null;
  try {
    const body = await req.json();
    message = String(body.message ?? "").trim();
    conversationId = body.conversationId ? String(body.conversationId) : null;
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }
  if (!message) return new Response("Message is required", { status: 400 });

  // --- Anonymous identity (no PHI/PII): a random opaque cookie id only. ---
  const jar = await cookies();
  let anonId = jar.get(ANON_COOKIE)?.value ?? null;
  const setCookie = !anonId;
  if (!anonId) anonId = crypto.randomUUID();

  // --- Ensure a conversation row exists ---
  if (!conversationId) {
    const rows = await query<{ id: string }>(
      `INSERT INTO ${T.conversation} (anon_id) VALUES ($1) RETURNING id`,
      [anonId]
    );
    conversationId = rows[0].id;
  }

  // Persist the user's message.
  await query(
    `INSERT INTO ${T.message} (conversation_id, role, content) VALUES ($1, 'user', $2)`,
    [conversationId, message]
  );

  const encoder = new TextEncoder();
  const baseHeaders: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "x-conversation-id": conversationId,
  };
  const headersWithCookie = (extra: Record<string, string>) => {
    const h = new Headers({ ...baseHeaders, ...extra });
    if (setCookie) {
      h.append(
        "Set-Cookie",
        `${ANON_COOKIE}=${anonId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`
      );
    }
    return h;
  };

  // --- Safety gate: emergencies never reach the LLM. ---
  if (detectEmergency(message)) {
    await query(
      `INSERT INTO ${T.message} (conversation_id, role, content, safety_flag) VALUES ($1, 'assistant', $2, 'emergency')`,
      [conversationId, EMERGENCY_MESSAGE]
    );
    return new Response(EMERGENCY_MESSAGE, {
      status: 200,
      headers: headersWithCookie({ "x-sources": sourcesHeader([]) }),
    });
  }

  // --- Retrieval (RAG over the physician-approved MedlinePlus corpus). ---
  let chunks: RetrievedChunk[] = [];
  try {
    const qvec = await embedQuery(message);
    chunks = await query<RetrievedChunk>(
      `SELECT c.id, c.content, d.title, d.url,
              1 - (c.embedding <=> $1::vector) AS similarity
       FROM ${T.chunk} c
       JOIN ${T.document} d ON d.id = c.document_id
       ORDER BY c.embedding <=> $1::vector
       LIMIT $2`,
      [qvec, RETRIEVAL_TOP_K]
    );
  } catch (err) {
    console.error("retrieval failed", err);
    return new Response("Search backend is unavailable.", { status: 503 });
  }

  // De-duplicate sources by document for display.
  const sources = Array.from(
    new Map(
      chunks.map((c) => [c.title, { title: c.title, url: c.url }])
    ).values()
  );

  // --- Stream the grounded completion, persist on completion. ---
  const cid = conversationId;
  const stream = new ReadableStream({
    async start(controller) {
      let full = "";
      try {
        const completion = await getOpenAI().chat.completions.create({
          model: CHAT_MODEL,
          temperature: 0.2,
          max_tokens: 600,
          stream: true,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "system", content: buildContextBlock(chunks) },
            { role: "user", content: message },
          ],
        });
        for await (const part of completion) {
          const token = part.choices[0]?.delta?.content ?? "";
          if (token) {
            full += token;
            controller.enqueue(encoder.encode(token));
          }
        }
      } catch (err) {
        console.error("completion failed", err);
        const fallback =
          "\n\nSorry — I couldn't generate a response just now. Please try again.";
        full += fallback;
        controller.enqueue(encoder.encode(fallback));
      }

      // Persist assistant message + citations (best-effort).
      try {
        const rows = await query<{ id: string }>(
          `INSERT INTO ${T.message} (conversation_id, role, content, model) VALUES ($1, 'assistant', $2, $3) RETURNING id`,
          [cid, full, CHAT_MODEL]
        );
        const messageId = rows[0].id;
        for (const c of chunks) {
          await query(
            `INSERT INTO ${T.citation} (message_id, chunk_id, similarity) VALUES ($1, $2, $3)`,
            [messageId, c.id, c.similarity]
          );
        }
      } catch (err) {
        console.error("persist failed", err);
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: headersWithCookie({ "x-sources": sourcesHeader(sources) }),
  });
}
