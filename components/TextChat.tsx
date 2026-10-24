"use client";

/**
 * Customer text chat: the typed alternative to the voice call. Each message goes through the same
 * backend turn as a call's utterance (convex/chat.ts → recordVoiceUtterance → takeTurn), so it is
 * recorded on the case as a "text" statement, linked to the question it answers, and the next
 * question comes from a reviewer, the reasoning model, or the rules. The transcript shown here is
 * display only; the statements on the case are the record.
 *
 * On an existing case it lists what the bank is still waiting to hear (convex/chat.ts
 * waitingQuestions) and opens with the first of those questions.
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Status = "idle" | "starting" | "open" | "ended" | "error";
interface Message { id: string; role: "customer" | "assistant"; text: string; failed?: boolean }

const OPENING_NEW = "Hi, I'm the bank's fraud support assistant. Tell me about the payment you don't recognize: the amount, who it was paid to and when, if you know.";
const OPENING_NOTHING_WAITING = "Welcome back. We don't need anything else from you right now. Is there anything you'd like to add to your report?";
const NOTHING_MORE = "Thank you. That's everything we need for now. You can add anything else here, or end the chat.";
const SOURCE_LABEL = { reviewer: "Our fraud team", model: "Our assistant", rules: "Our assistant" } as const;

const newId = () => crypto.randomUUID().replace(/-/g, "");

interface TextChatProps {
  /** The case to chat about, or a resolver run when the chat starts (a new report creates its case then). */
  caseId: () => Promise<Id<"cases">>;
  /** Known before the chat starts when continuing an existing case: its waiting questions are shown up front. */
  existingCaseId?: Id<"cases"> | null;
  /** Told when a chat opens or closes (the page locks its pickers meanwhile). */
  onInChatChange?: (inChat: boolean) => void;
}

export function TextChat({ caseId, existingCaseId = null, onInChatChange }: TextChatProps) {
  const startChat = useMutation(api.chat.startChat);
  const send = useAction(api.chat.send);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{ token: string; caseId: Id<"cases"> } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const questionId = useRef<string | null>(null);
  // Only when continuing an existing case: in a new report it would repeat the question just asked.
  const waiting = useQuery(api.chat.waitingQuestions, existingCaseId ? { caseId: existingCaseId } : "skip");
  const end = useRef<HTMLDivElement>(null);

  const open = status === "starting" || status === "open";
  useEffect(() => {
    onInChatChange?.(open);
  }, [open, onInChatChange]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, sending]);

  async function start() {
    setStatus("starting");
    setError(null);
    setMessages([]);
    questionId.current = null;
    try {
      const id = await caseId();
      const s = await startChat({ caseId: id });
      setSession({ token: s.token, caseId: id });
      questionId.current = s.opening?.questionId ?? null;
      const opening = s.opening ? `Welcome back. We have a question about your report: ${s.opening.text}` : s.reported ? OPENING_NOTHING_WAITING : OPENING_NEW;
      setMessages([{ id: "opening", role: "assistant", text: opening }]);
      setStatus("open");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /s, "").split("\n")[0]! : String(e));
    }
  }

  async function deliver(m: Message) {
    if (!session) return;
    setSending(true);
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, failed: false } : x)));
    try {
      const r = await send({ sessionToken: session.token, text: m.text, messageId: m.id, ...(questionId.current ? { questionId: questionId.current } : {}) });
      questionId.current = r.question_id;
      setMessages((prev) => [...prev, { id: `${m.id}-reply`, role: "assistant", text: r.question ?? NOTHING_MORE }]);
    } catch (e) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, failed: true } : x)));
      setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /s, "").split("\n")[0]! : String(e));
    } finally {
      setSending(false);
    }
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sending || status !== "open") return;
    const m: Message = { id: newId(), role: "customer", text };
    setDraft("");
    setError(null);
    setMessages((prev) => [...prev, m]);
    void deliver(m);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="tc">
      {waiting && waiting.length > 0 && (
        <section className="tc-waiting" aria-label="Questions waiting for you">
          <strong>We&apos;re still waiting to hear from you about</strong>
          <ul>
            {waiting.map((q) => (
              <li key={q.key}>
                {q.text} <span className="tc-source">{SOURCE_LABEL[q.source]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {status === "idle" || status === "ended" || status === "error" ? (
        <div className="tc-start">
          <button type="button" className="tc-start-button" onClick={start}>
            {status === "idle" ? "Start chat" : "Start a new chat"}
          </button>
          {status === "ended" && <p className="muted">Chat ended. Thank you — a member of our team will review your report.</p>}
          {status === "error" && error && <p className="error">{error}</p>}
          {status === "idle" && <p className="muted">You&apos;ll be chatting with an automated assistant. What you type is saved to your report for our fraud team to review.</p>}
        </div>
      ) : null}

      {messages.length > 0 && (
        <div className="cc-transcript tc-transcript" aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} className={`cc-bubble ${m.role === "customer" ? "cc-user" : "cc-agent"}`}>
              <span className="cc-speaker">{m.role === "customer" ? "You" : "Assistant"}</span>
              {m.text}
              {m.failed && (
                <span className="tc-failed">
                  {" "}Not sent.{" "}
                  <button type="button" className="tc-retry" disabled={sending} onClick={() => deliver(m)}>Retry</button>
                </span>
              )}
            </div>
          ))}
          {sending && <div className="cc-bubble cc-agent tc-typing">Assistant is typing…</div>}
          <div ref={end} />
        </div>
      )}

      {status === "starting" && <p className="muted">Opening the chat…</p>}
      {status === "open" && (
        <form className="tc-compose" onSubmit={submit}>
          <label className="tc-visually-hidden" htmlFor="tc-input">Your message</label>
          <textarea id="tc-input" rows={2} value={draft} placeholder="Type your message…" disabled={sending} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} />
          <div className="tc-actions">
            <button type="submit" disabled={sending || !draft.trim()}>Send</button>
            <button type="button" className="tc-end" onClick={() => setStatus("ended")}>End chat</button>
          </div>
          {error && <p className="error tc-error">{error}</p>}
        </form>
      )}
    </div>
  );
}
