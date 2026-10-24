/**
 * Removes secrets a customer may read out (card numbers, one-time codes, PINs, passwords, SSNs)
 * from statement text BEFORE it is stored or logged. The claim never needs the values, only
 * the kind of thing that was shared, so only the kind is kept.
 *
 * Limits (known): spoken digits ("four eight two…") and codes without a nearby keyword are not
 * detected.
 */
export type RedactionKind = "card_number" | "code" | "password" | "ssn";

export interface RedactionResult {
  text: string;
  kinds: RedactionKind[];
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const PASSWORD = /\b(password)(\s*(?:is|was|:)\s*)([^\s,.;!?]+)/gi;
// A keyword, optional filler ("is", "was", ":"), then 3-10 digits that are not a money amount.
const CODE =
  /\b((?:one[- ]time\s+)?(?:pass)?code|otp|pin|security\s+code|verification\s+(?:code|number)|cvv|cvc)(\s*(?:number\s*)?(?:is|was|of|:|=)?\s*)(\d(?:[ -]?\d){2,9})\b(?!\s*(?:dollars?|usd|bucks|cents?))/gi;

export function redactSensitive(input: string): RedactionResult {
  const kinds = new Set<RedactionKind>();
  let text = input.replace(CARD, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return m;
    kinds.add("card_number");
    return "[REDACTED:card_number]";
  });
  text = text.replace(SSN, () => {
    kinds.add("ssn");
    return "[REDACTED:ssn]";
  });
  text = text.replace(PASSWORD, (_m, kw: string, sep: string) => {
    kinds.add("password");
    return `${kw}${sep}[REDACTED:password]`;
  });
  text = text.replace(CODE, (_m, kw: string, sep: string) => {
    kinds.add("code");
    return `${kw}${sep}[REDACTED:code]`;
  });
  return { text, kinds: [...kinds] };
}
