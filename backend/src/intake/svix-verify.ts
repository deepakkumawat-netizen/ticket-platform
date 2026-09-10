import { createHmac, timingSafeEqual } from 'crypto';

// Resend's inbound-email webhook (and every other Resend webhook event) is
// signed using the Svix format — verified against Svix's own published
// manual-verification algorithm (docs.svix.com/receiving/verifying-payloads/
// how-manual), since this codebase calls Resend's HTTPS API directly (see
// mailer.service.ts) rather than depending on their SDK, which would
// otherwise provide `resend.webhooks.verify()` for free.
//
// Algorithm: secret is "whsec_<base64>" — decode the part after the prefix.
// Sign `${svixId}.${svixTimestamp}.${rawBody}` with HMAC-SHA256 using the
// decoded secret as the key, base64-encode the result, and compare against
// each `v1,<base64sig>` entry in the (space-separated, possibly
// multi-valued) svix-signature header.
//
// Split out from verifySvixSignature below so it can be unit-tested against
// Svix's own published worked example (a fixed id/timestamp/body/secret with
// a known expected signature) without that test also having to fight the
// replay-window check, which is deliberately time-dependent.
export function computeSvixSignature(svixId: string, svixTimestamp: string, rawBody: Buffer | string, secret: string): string {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody.toString()}`;
  return createHmac('sha256', secretBytes).update(signedContent).digest('base64');
}

export function verifySvixSignature(
  rawBody: Buffer | string,
  headers: { svixId?: string; svixTimestamp?: string; svixSignature?: string },
  secret: string,
): boolean {
  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // A generous but bounded window guards against a captured request being
  // replayed indefinitely — Svix's own docs recommend rejecting anything
  // outside roughly this range.
  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (ageSeconds > 5 * 60) return false;

  const expected = computeSvixSignature(svixId, svixTimestamp, rawBody, secret);
  const expectedBuf = Buffer.from(expected);

  return svixSignature
    .split(' ')
    .map((entry) => entry.split(',')[1])
    .filter((sig): sig is string => !!sig)
    .some((sig) => {
      const sigBuf = Buffer.from(sig);
      // timingSafeEqual throws on length mismatch rather than returning
      // false — never let a malformed signature 500 the whole webhook.
      return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
    });
}
