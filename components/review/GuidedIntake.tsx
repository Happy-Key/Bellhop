"use client";

/**
 * "How the intake progressed": each reply attached to the question it answered, what the rules
 * read from it, and what was asked next and why. View model: lib/review/intake.ts.
 */
import type { OpenQuestion } from "@/lib/domain/schemas";
import type { Established, IntakeProgress, IntakeQuestion, IntakeTurn } from "@/lib/review/intake";
import type { DemoSnapshot } from "@/lib/review/demoCase";
import { RefChip } from "./EvidenceRef";
import { AudienceTag, KindTag } from "./Tags";
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

export function GuidedIntake({ progress, snapshots }: { progress: IntakeProgress; snapshots?: DemoSnapshot[] }) {
  const after = new Map((snapshots ?? []).map((s) => [s.ref, s]));
  const { turns, next } = progress;
  return (
    <section id="intake" className="ws-section" aria-labelledby="intake-h">
      <div className="ws-section-head">
        <h2 id="intake-h">How the intake progressed</h2>
        <p className="ws-muted ws-small">
          Each customer reply, attached to the question it answered. Only submitted replies are stored, so this is not a full call transcript. Questions come from the
          rules; the assistant only words them.
        </p>
      </div>

      {turns.length === 0 && <p className="ws-muted">No replies yet.</p>}
      <ol className="ws-intake">
        {turns.map((t) => {
          const snap = after.get(t.ref);
          return (
            <li key={t.ref} className="ws-turn">
              {t.asked ? <QuestionBlock q={t.asked} label="Question asked" /> : <div className="ws-turn-q"><span className="ws-eyebrow">No recorded question</span> <span className="ws-small ws-muted">{t.state === "opening" ? "The customer's own account, not a reply to a backend question." : ""}</span></div>}
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
                <span className="ws-eyebrow">Read from this reply</span> <KindTag kind="reported" />
                {t.interpretation === "pending" ? (
                  <p className="ws-small ws-muted">Interpretation pending. Facts from this reply aren&apos;t in the analysis yet.</p>
                ) : t.interpretation === "failed" ? (
                  <p className="ws-small ws-error-text">Interpretation failed{t.interpretationError ? `: ${t.interpretationError}` : ""}. Not interpreted.</p>
                ) : t.established.length === 0 ? (
                  <p className="ws-small ws-muted">Nothing new was read from this reply.</p>
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
              {snap && <StillOpen open={snap.open} />}
            </li>
          );
        })}
      </ol>

      <div className="ws-intake-next" aria-live="polite">
        {next.status === "awaiting_report" && <p className="ws-muted">Waiting for the customer&apos;s report.</p>}
        {next.status === "awaiting_interpretation" && (
          <p>
            <strong>Waiting for interpretation</strong> of {next.refs.map((r) => <RefChip key={r} refId={r} />)}. The next question is chosen after it lands, because the pending reply
            may already answer it.
          </p>
        )}
        {next.status === "question" && (
          <>
            <QuestionBlock q={next.question} label="Next question for the customer" />
            <p className="ws-small ws-muted">The assistant receives only this question on the next turn. It never sees the draft route.</p>
          </>
        )}
        {next.status === "reviewer_only" && <p><AudienceTag audience="reviewer" /> No customer questions remain. {next.count} item{next.count === 1 ? "" : "s"} need a bank reviewer.</p>}
        {next.status === "complete" && <p className="ws-muted">No open questions remain for the customer or a reviewer.</p>}
      </div>
    </section>
  );
}

function StillOpen({ open }: { open: OpenQuestion[] }) {
  return (
    <div className="ws-turn-open">
      <span className="ws-eyebrow">Still open after this reply</span>
      {open.length === 0 ? (
        <span className="ws-small ws-muted">Nothing.</span>
      ) : (
        <ul>
          {open.map((q) => (
            <li key={q.key} className="ws-small">
              <AudienceTag audience={q.audience} /> {q.blocking ? <strong>Blocking</strong> : <span className="ws-muted">Non-blocking</span>} · {q.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
