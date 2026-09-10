// Shared by ai.service.ts's chat assistant (parsing "TECH-42"/"ticket 42"/
// "#42" out of a staff member's question) and intake's inbound-email
// handler (parsing the same out of a reply's subject line, e.g.
// "Re: [TECH-42] Assigned to you"). One implementation so the two never
// drift apart — see tickets.service.ts's ticketNumber comment for why the
// digits alone (not the department-key prefix) are what's actually matched.
export function extractTicketNumber(text: string): number | null {
  const dashMatch = text.match(/\b[A-Za-z]{2,15}-(\d{1,9})\b/);
  if (dashMatch) return Number(dashMatch[1]);
  const wordMatch = text.match(/\bticket\s*#?\s*(\d{1,9})\b/i) ?? text.match(/#(\d{1,9})\b/);
  return wordMatch ? Number(wordMatch[1]) : null;
}
