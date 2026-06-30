"use client";

import { useRef, useState } from "react";

type Source = { title: string; url: string | null };
type Msg = { role: "user" | "assistant"; content: string; sources?: Source[] };

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const conversationId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    );
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [
      ...m,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);
    scrollToBottom();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationId: conversationId.current }),
      });

      conversationId.current =
        res.headers.get("x-conversation-id") ?? conversationId.current;
      let sources: Source[] = [];
      const sraw = res.headers.get("x-sources");
      if (sraw) {
        try {
          sources = JSON.parse(atob(sraw));
        } catch {}
      }

      if (!res.ok || !res.body) {
        const errText = (await res.text().catch(() => "")) || "Something went wrong.";
        updateLast(errText, sources);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        updateLast(acc, sources);
        scrollToBottom();
      }
    } catch {
      updateLast("Network error. Please try again.", []);
    } finally {
      setBusy(false);
      scrollToBottom();
    }
  }

  function updateLast(content: string, sources: Source[]) {
    setMessages((m) => {
      const copy = [...m];
      copy[copy.length - 1] = { role: "assistant", content, sources };
      return copy;
    });
  }

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto">
      {/* Disclaimer — always visible, per the PHI/safety design */}
      <header className="px-4 py-3 border-b border-black/10 dark:border-white/15">
        <h1 className="text-base font-semibold">Health Info Assistant</h1>
        <p className="text-xs text-black/60 dark:text-white/60 mt-0.5">
          General health information only — <strong>not medical advice</strong> and not a
          substitute for a clinician. Don’t share personal or identifying health details.
          In an emergency call 911.
        </p>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-sm text-black/50 dark:text-white/50 mt-8 text-center">
            Ask a general health question — e.g. “What are common symptoms of the flu?”
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <div
              className={
                "inline-block rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap " +
                (m.role === "user"
                  ? "bg-foreground text-background"
                  : "bg-black/[.06] dark:bg-white/[.10]")
              }
            >
              {m.content || (busy && i === messages.length - 1 ? "…" : "")}
            </div>
            {m.role === "assistant" && m.sources && m.sources.length > 0 && (
              <div className="mt-1.5 text-xs text-black/55 dark:text-white/55">
                Sources:{" "}
                {m.sources.map((s, j) => (
                  <span key={j}>
                    {j > 0 && ", "}
                    {s.url ? (
                      <a
                        className="underline underline-offset-2"
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {s.title}
                      </a>
                    ) : (
                      s.title
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-black/10 dark:border-white/15 p-3">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-full border border-black/15 dark:border-white/20 bg-transparent px-4 py-2 text-sm outline-none focus:border-black/40 dark:focus:border-white/40"
            placeholder="Ask a general health question…"
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button
            className="rounded-full bg-foreground text-background px-5 py-2 text-sm font-medium disabled:opacity-40"
            onClick={send}
            disabled={busy || !input.trim()}
          >
            Send
          </button>
        </div>
        <p className="text-[10px] text-black/40 dark:text-white/40 mt-2 text-center">
          Health information from MedlinePlus.gov (U.S. National Library of Medicine, NIH).
        </p>
      </div>
    </div>
  );
}
