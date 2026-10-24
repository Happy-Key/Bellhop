"use client";

/**
 * "How the intake progressed": each reply attached to the question it answered, what the rules
 * read from it, and what was asked next and why. View model: lib/review/intake.ts.
 */
import type { Established, IntakeProgress, IntakeQuestion, IntakeTurn } from "@/lib/review/intake";
import { RefChip } from "./EvidenceRef";
import { Mark } from "./ui";
import { CREDENTIALS_LABEL, POSITION_LABEL, clockTime, exactTime, humanize, shortKey, usd } from "./format";

const STATE_LABEL: Record<IntakeTurn["state"], string> = {
  opening: "Opening account",
  answered: "Answered",
  unknown: "Customer didn't know",
  declined: "Customer declined",
  unparsed: "Reply didn't settle the question",
};

function EstablishedItem({ e }: { e: Established }) {
  switch (e.field) {
    case "confirms":
      return <>Confirmed bank record <RefChip refId={e.value} /></>;
    case "rejects":
      return <>Said record <RefChip refId={e.value} /> is not the payment</>;
    case "position":
      return <>{POSITION_LABEL[e.value] ?? humanize(e.value)}</>;
    case "credentials":
      return <>{CREDENTIALS_LABEL[e.value] ?? humanize(e.value)}</>;
    case "amount":
      return <>Amount mentioned: {usd(Number(e.value))}</>;
    case "date":
      return <>Date mentioned: {e.value}</>;
    case "payee":
      return <>Payee mentioned: “{e.value}”</>;
    case "scam_sign":
      return <>Scam sign mentioned: “{e.value}”</>;
  }
}

function QuestionBlock({ q, label }: { q: IntakeQuestion; label: string }) {
  return (
    <div className="ws-turn-q">
      <span className="ws-eyebrow">{label}</span>
      <p className="ws-turn-qtext">“{q.text}”</p>
      <p className="ws-small ws-muted">
        {q.why && <>Why: {q.why} </>}
        {q.refs.map((r) => <RefChip key={r} refId={r} />)}
        <code className="ws-key" title={`Stable question key: ${q.key}`}>{shortKey(q.key)}</code>
      </p>
    </div>
  );
}

export function GuidedIntake({ progress }: { progress: IntakeProgress }) {
  const { turns, next } = progress;
  return (
    <section id="intake" className="ws-section" aria-labelledby="intake-h">
      <div className="ws-section-head">
        <h2 id="intake-h">Conversation</h2>
      </div>

      {turns.length === 0 && <p className="ws-muted">No replies yet.</p>}
      <ol className="ws-intake">
        {turns.map((t) => (
          <li key={t.ref} className="ws-turn">
            {t.asked ? <QuestionBlock q={t.asked} label="Question asked" /> : <div className="ws-turn-q"><span className="ws-eyebrow">No recorded question</span> <span className="ws-small ws-muted">{t.state === "opening" ? "Opening account" : ""}</span></div>}
            <div className="ws-turn-a">
              <div className="ws-turn-meta">
                <RefChip refId={t.ref} />
                <span>Customer · {t.reply.channel}</span>
                <time dateTime={new Date(t.reply.receivedAt).toISOString()} title={exactTime(t.reply.receivedAt)}>{clockTime(t.reply.receivedAt)}</time>
                <span className={`ws-answer ws-answer-${t.state}`}>{STATE_LABEL[t.state]}</span>
                {t.reply.correctsRef && <span>corrects <RefChip refId={t.reply.correctsRef} /></span>}
              </div>
              <p className="ws-turn-reply">“{t.reply.text}”</p>
              {t.reply.redactions && t.reply.redactions.length > 0 && <p className="ws-small ws-muted">Removed before storage: {t.reply.redactions.map(humanize).join(", ")}.</p>}
            </div>
            <div className="ws-turn-est">
              <span className="ws-eyebrow">Read from this reply</span> <Mark kind="reported" />
              {t.interpretation === "pending" ? (
                <p className="ws-small ws-muted">Pending.</p>
              ) : t.interpretation === "failed" ? (
                <p className="ws-small ws-error-text">Interpretation failed{t.interpretationError ? `: ${t.interpretationError}` : ""}. Not interpreted.</p>
              ) : t.established.length === 0 ? (
                <p className="ws-small ws-muted">Nothing new.</p>
              ) : (
                <ul className="ws-est">
                  {t.established.map((e) => (
                    <li key={`${e.field}-${e.value}`}>
                      <EstablishedItem e={e} />{" "}
                      <span className="ws-muted ws-small">· {e.via === "reply_parser" ? "reply read against its question (rules)" : t.reader?.mode === "live" ? `model · ${t.reader.provider}` : "scripted extractor"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="ws-intake-next" aria-live="polite">
        {next.status === "awaiting_report" && <p className="ws-muted">Waiting for the report.</p>}
        {next.status === "awaiting_interpretation" && (
          <p>
            <strong>Waiting for interpretation</strong> of {next.refs.map((r) => <RefChip key={r} refId={r} />)}. The next question is chosen after it lands, because the pending reply
            may already answer it.
          </p>
        )}
        {next.status === "question" && (
          <>
            <QuestionBlock q={next.question} label="Next question for the customer" />
          </>
        )}
        {next.status === "reviewer_only" && <p><Mark kind="bank" /> No customer questions remain. {next.count} item{next.count === 1 ? "" : "s"} need a bank reviewer.</p>}
        {next.status === "complete" && <p className="ws-muted">No open questions.</p>}
      </div>
    </section>
  );
}
