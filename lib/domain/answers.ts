/**
 * Reads a reply in the context of the question it answers (RULE-BASED, labelled by parser ID).
 *
 * Short replies ("me", "someone else", "yes, that one", "I don't know") carry no facts on their
 * own; with the question as context they do. This runs at insert time in both reasoning modes and
 * is separate from statement interpretation: it never stands in for a failed live interpretation.
 */
import type { AskedQuestion, StatementAnswer } from "./schemas";

export const ANSWER_PARSER = "answer-slot-parser@1";

const UNKNOWN = /\b(?:i\s+(?:do\s*n[o']?t|dont)\s+know|not\s+sure|no\s+idea|i\s+(?:can(?:no|')t|cannot)\s+(?:remember|recall|tell)|unsure|i'?m\s+not\s+certain)\b/i;
const DECLINED = /\b(?:rather\s+not\s+(?:say|answer)|prefer\s+not\s+to|do\s*n[o']?t\s+want\s+to\s+(?:say|answer|tell))\b/i;
const YES = /^\s*(?:yes|yeah|yep|yup|correct|right|that'?s\s+(?:it|right|the\s+one|correct)|that\s+one|exactly)\b/i;
const NO = /^\s*(?:no|nope|nah|not\s+that\s+one|that'?s\s+not\s+(?:it|the\s+one|right))\b/i;

const OTHER_PERSON = /\b(?:someone\s+else|somebody\s+else|they\s+did|he\s+did|she\s+did|the\s+(?:scammer|caller|fraudster|other\s+person)|not\s+me|i\s+did\s*n[o']?t(?:\s+(?:send|make|do))?|wasn'?t\s+me)\b/i;
const CUSTOMER =
  /^\s*(?:yes,?\s+)?(?:me|myself|it\s+was\s+me|i\s+did(?!\s*n))\b|\bi\s+(?:sent|entered|made|typed|pressed|did)\s+(?:it|that|them|the\s+(?:payment|transfer)|it\s+myself)\b|\bi\s+(?:personally|myself)\b|\bit\s+was\s+me\b/i;

// A reply that opens by saying the customer did it ("Yes, I did it myself. ... because the caller told
// me to") is about the customer, even when it goes on to mention the caller (live 2026-10-24: read as
// "someone else", which raised a false contradiction and a repeated question).
const LEADS_WITH_SELF = /^\s*(?:(?:yes|yeah|yep),?\s+)?(?:me|myself|it\s+was\s+me|i\s+did(?!\s*n)|i\s+(?:made|sent|paid|bought|ordered|entered|typed))\b/i;
const SOMEONE_ELSE = /\b(?:someone|somebody)\s+else\b/i;

// "I don't recognize it" / "No, I've never shopped there" reply to "did you make it yourself?" with a denial.
const NOT_RECOGNIZED = /\b(?:do\s*n[o']?t|did\s*n[o']?t|dont|didnt)\s+recogni[sz]e\b|\bnever\s+(?:seen|heard\s+of|shopped|been|bought|used|made|sent)\b|^\s*(?:no|nope|nah|never)\b/i;

const SHARED = /\b(?:codes?|passwords?|pins?|card\s+(?:number|details)|one[- ]time|verification|login|security\s+(?:code|answers?))\b/i;
const NOTHING_SHARED = /^\s*(?:no|nope|nobody|no\s+one|none|nothing)\b/i;
// "They asked for a code but I didn't give it": being asked is not sharing.
const REFUSED = /\b(?:did\s*n[o']?t|didnt|never|refused\s+to|would\s*n[o']?t|wouldnt)\s+(?:give|gave|share|shared|tell|told|read|send|sent|say)\b|\bhung\s+up\b/gi;
// A positive act of sharing outside the refusal outweighs it ("I never gave the password, but I read them the code").
const GAVE = /\b(?:gave|shared|read\s+(?:out|them|him|her|it)|told\s+(?:them|him|her))\b/i;

/** Returns undefined when the statement was not a reply to a known question. */
export function interpretAnswer(text: string, asked: AskedQuestion | undefined, relatedRef?: string): StatementAnswer | undefined {
  if (!asked) return undefined;
  const base = { key: asked.key, kind: asked.kind, parser: ANSWER_PARSER };
  if (DECLINED.test(text)) return { ...base, state: "declined" };

  // Conflict questions about who sent the payment, or about shared credentials, are re-asked in
  // the same words as the original question, so their replies parse the same way.
  const kind = asked.key === "conflict:authorization" ? "initiation" : asked.key === "conflict:credentialSharing" ? "credential_sharing" : asked.kind;
  switch (kind) {
    case "initiation": {
      if (LEADS_WITH_SELF.test(text) && !SOMEONE_ELSE.test(text)) return { ...base, state: "answered", derived: { authorization: "authorized" } };
      // "someone else" is checked first: "not me" contains "me".
      if (OTHER_PERSON.test(text)) return { ...base, state: "answered", derived: { authorization: "denies_authorization" } };
      if (CUSTOMER.test(text)) return { ...base, state: "answered", derived: { authorization: "authorized" } };
      // The read-back ("did you make it yourself?") is a yes/no question; the open one is not.
      if (asked.key === "confirm:authorization" && YES.test(text)) return { ...base, state: "answered", derived: { authorization: "authorized" } };
      if (NOT_RECOGNIZED.test(text)) return { ...base, state: "answered", derived: { authorization: "denies_authorization" } };
      break;
    }
    // Questions that ask about one specific bank record (its ref is in the key) take a yes or no.
    case "tentative_match":
    case "ambiguous_match":
    case "multiple_amounts": {
      if (!relatedRef) break;
      if (NO.test(text)) return { ...base, state: "answered", derived: { rejectsTxnRef: relatedRef } };
      if (YES.test(text)) return { ...base, state: "answered", derived: { confirmsTxnRef: relatedRef } };
      break;
    }
    case "credential_sharing": {
      const withoutRefusals = text.replace(REFUSED, "");
      if (withoutRefusals !== text && !GAVE.test(withoutRefusals)) return { ...base, state: "answered", derived: { credentialSharing: "not_shared" } };
      if (NOTHING_SHARED.test(text) && !/\b(?:but|except)\b/i.test(text)) return { ...base, state: "answered", derived: { credentialSharing: "not_shared" } };
      if (YES.test(text) || SHARED.test(text)) return { ...base, state: "answered", derived: { credentialSharing: "shared" } };
      break;
    }
    case "code_purpose":
    case "payment_purpose":
    case "narrative":
      // Open questions: any substantive reply answers them; the words are the answer.
      if (UNKNOWN.test(text)) return { ...base, state: "unknown" };
      return { ...base, state: text.trim().split(/\s+/).length >= 2 ? "answered" : "unparsed" };
    default:
      break;
  }
  if (UNKNOWN.test(text)) return { ...base, state: "unknown" };
  return { ...base, state: "unparsed" };
}

/** The transaction a tentative-match question asks about is encoded in its key ("tentative:T:abc"). */
export function relatedRefFromKey(key: string): string | undefined {
  const m = key.match(/^tentative:(T:[A-Za-z0-9_-]+)$/);
  return m?.[1];
}
