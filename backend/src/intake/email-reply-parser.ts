// Pure, dependency-free parsing helpers for the inbound-email intake path —
// kept separate from intake.service.ts so they're unit-testable without any
// Prisma/Resend mocking.

/** Parses a "Name <email@x.com>" or bare "email@x.com" From header into its
 * parts. Good-enough, not a full RFC 5322 parser — real-world From headers
 * are near-universally one of these two shapes. */
export function parseFromHeader(from: string): { name: string | null; email: string | null } {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].trim();
    return { name: name.length > 0 ? name : null, email: match[2].trim() };
  }
  const bareEmailMatch = from.match(/^[^\s@]+@[^\s@]+$/);
  return bareEmailMatch ? { name: null, email: from.trim() } : { name: null, email: null };
}

// Common markers a quoted-reply-history block starts with, across the major
// mail clients (Gmail, Outlook, Apple Mail). Good-enough truncation, not a
// full quote-parser — see intake.service.ts's comment on this being
// explicitly flagged as v1-adequate, not perfect.
const QUOTE_MARKERS = [
  /\r?\n\s*On .{0,120} wrote:\s*\r?\n/i,
  /\r?\n\s*-{2,}\s*Original Message\s*-{2,}/i,
  /\r?\n\s*From:\s*.+\r?\nSent:\s*.+\r?\nTo:\s*.+/i, // Outlook's reply header block
  /\r?\n>{1}/, // first quoted line (a line starting with ">")
];

/** Truncates a reply body at the first quoted-history marker, so a ticket
 * comment shows only what the person actually typed, not their entire
 * back-and-forth history repeated on every reply. */
export function stripQuotedReplyText(body: string): string {
  let cutIndex = body.length;
  for (const marker of QUOTE_MARKERS) {
    const match = body.match(marker);
    if (match && match.index !== undefined && match.index < cutIndex) {
      cutIndex = match.index;
    }
  }
  return body.slice(0, cutIndex).trim();
}
