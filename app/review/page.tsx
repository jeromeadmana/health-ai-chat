import { query } from "@/lib/db";
import { T } from "@/lib/config";

// Read-only clinical review view. Renders at request time (never static).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Conversation = { id: string; anon_id: string | null; created_at: string };
type Message = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  model: string | null;
  safety_flag: string | null;
  created_at: string;
};
type Citation = {
  message_id: string;
  title: string;
  url: string | null;
  similarity: number;
};

function fmt(ts: string) {
  // Stable, locale-independent rendering.
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  // Optional access gate. If REVIEW_TOKEN is set, require a matching ?token=.
  const expected = process.env.REVIEW_TOKEN;
  const locked = Boolean(expected) && token !== expected;
  if (locked) {
    return (
      <main className="max-w-md mx-auto p-8 text-sm">
        <h1 className="text-lg font-semibold mb-2">Clinical Review</h1>
        <p className="text-black/60 dark:text-white/60">
          Access denied. Append <code>?token=…</code> with the configured REVIEW_TOKEN.
        </p>
      </main>
    );
  }

  const conversations = await query<Conversation>(
    `SELECT id, anon_id, created_at FROM ${T.conversation} ORDER BY created_at DESC LIMIT 50`
  );

  let messages: Message[] = [];
  let citations: Citation[] = [];
  if (conversations.length > 0) {
    const ids = conversations.map((c) => c.id);
    messages = await query<Message>(
      `SELECT id, conversation_id, role, content, model, safety_flag, created_at
       FROM ${T.message} WHERE conversation_id = ANY($1) ORDER BY created_at ASC`,
      [ids]
    );
    citations = await query<Citation>(
      `SELECT mc.message_id, d.title, d.url, mc.similarity
       FROM ${T.citation} mc
       JOIN ${T.chunk} ch ON ch.id = mc.chunk_id
       JOIN ${T.document} d ON d.id = ch.document_id
       WHERE mc.message_id IN (
         SELECT id FROM ${T.message} WHERE conversation_id = ANY($1)
       )`,
      [ids]
    );
  }

  const msgsByConv = new Map<string, Message[]>();
  for (const m of messages) {
    const arr = msgsByConv.get(m.conversation_id) ?? [];
    arr.push(m);
    msgsByConv.set(m.conversation_id, arr);
  }
  // De-duplicate citations per message by document title.
  const citesByMsg = new Map<string, Map<string, Citation>>();
  for (const c of citations) {
    const m = citesByMsg.get(c.message_id) ?? new Map<string, Citation>();
    if (!m.has(c.title)) m.set(c.title, c);
    citesByMsg.set(c.message_id, m);
  }

  return (
    <main className="max-w-3xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Clinical Review</h1>
        <p className="text-xs text-black/60 dark:text-white/60 mt-1">
          Read-only. {conversations.length} most recent conversations · anonymous sessions
          (no PHI). Review answers and the sources that grounded them.
        </p>
      </header>

      {conversations.length === 0 && (
        <p className="text-sm text-black/60 dark:text-white/60">No conversations yet.</p>
      )}

      <div className="space-y-6">
        {conversations.map((conv) => {
          const msgs = msgsByConv.get(conv.id) ?? [];
          return (
            <section
              key={conv.id}
              className="border border-black/10 dark:border-white/15 rounded-lg overflow-hidden"
            >
              <div className="px-4 py-2 bg-black/[.04] dark:bg-white/[.06] text-xs text-black/60 dark:text-white/60 flex justify-between">
                <span>conv {conv.id.slice(0, 8)} · anon {conv.anon_id?.slice(0, 8) ?? "—"}</span>
                <span>{fmt(conv.created_at)}</span>
              </div>
              <div className="p-4 space-y-3">
                {msgs.map((m) => {
                  const cites = Array.from(citesByMsg.get(m.id)?.values() ?? []);
                  return (
                    <div key={m.id} className="text-sm">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
                          {m.role}
                        </span>
                        {m.safety_flag && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400">
                            {m.safety_flag}
                          </span>
                        )}
                        {m.model && (
                          <span className="text-[10px] text-black/40 dark:text-white/40">
                            {m.model}
                          </span>
                        )}
                      </div>
                      <div className="whitespace-pre-wrap text-black/80 dark:text-white/80">
                        {m.content}
                      </div>
                      {cites.length > 0 && (
                        <div className="mt-1 text-xs text-black/50 dark:text-white/50">
                          Grounded in:{" "}
                          {cites.map((c, i) => (
                            <span key={i}>
                              {i > 0 && ", "}
                              {c.url ? (
                                <a
                                  className="underline underline-offset-2"
                                  href={c.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {c.title}
                                </a>
                              ) : (
                                c.title
                              )}
                              <span className="text-black/30 dark:text-white/30">
                                {" "}
                                ({c.similarity.toFixed(2)})
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
