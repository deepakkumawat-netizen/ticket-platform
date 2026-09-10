import { computeSvixSignature, verifySvixSignature } from './svix-verify';

// computeSvixSignature is checked against Svix's own published worked
// example (docs.svix.com/receiving/verifying-payloads/how-manual) — if this
// ever stops matching, the algorithm itself (not just this codebase's use of
// it) has drifted from spec, so this is worth keeping exact rather than only
// testing our own round-trip.
const DOCS_EXAMPLE = {
  secret: 'whsec_plJ3nmyCDGBKInavdOK15jsl',
  svixId: 'msg_loFOjxBNrRLzqYUf',
  svixTimestamp: '1731705121',
  body: '{"event_type":"ping","data":{"success":true}}',
  expectedSignature: 'rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=',
};

describe('computeSvixSignature', () => {
  it('matches the signature from Svix\'s own published worked example', () => {
    const sig = computeSvixSignature(DOCS_EXAMPLE.svixId, DOCS_EXAMPLE.svixTimestamp, DOCS_EXAMPLE.body, DOCS_EXAMPLE.secret);
    expect(sig).toBe(DOCS_EXAMPLE.expectedSignature);
  });
});

describe('verifySvixSignature', () => {
  const secret = DOCS_EXAMPLE.secret;
  const body = '{"type":"email.received","data":{"email_id":"abc123"}}';

  function sign(svixId: string, svixTimestamp: string) {
    return `v1,${computeSvixSignature(svixId, svixTimestamp, body, secret)}`;
  }

  it('accepts a correctly signed, freshly timestamped request', () => {
    const svixId = 'msg_test1';
    const svixTimestamp = String(Math.floor(Date.now() / 1000));
    const ok = verifySvixSignature(body, { svixId, svixTimestamp, svixSignature: sign(svixId, svixTimestamp) }, secret);
    expect(ok).toBe(true);
  });

  it('rejects a tampered body (signature no longer matches)', () => {
    const svixId = 'msg_test2';
    const svixTimestamp = String(Math.floor(Date.now() / 1000));
    const validSignatureForOriginalBody = sign(svixId, svixTimestamp);
    const ok = verifySvixSignature('{"type":"email.received","data":{"email_id":"TAMPERED"}}', { svixId, svixTimestamp, svixSignature: validSignatureForOriginalBody }, secret);
    expect(ok).toBe(false);
  });

  it('rejects a signature signed with the wrong secret', () => {
    const svixId = 'msg_test3';
    const svixTimestamp = String(Math.floor(Date.now() / 1000));
    const wrongSig = `v1,${computeSvixSignature(svixId, svixTimestamp, body, 'whsec_wrongSecretEntirely')}`;
    expect(verifySvixSignature(body, { svixId, svixTimestamp, svixSignature: wrongSig }, secret)).toBe(false);
  });

  it('rejects a request whose timestamp is far outside the replay window', () => {
    const svixId = 'msg_test4';
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 3600); // 1 hour old
    const ok = verifySvixSignature(body, { svixId, svixTimestamp: oldTimestamp, svixSignature: sign(svixId, oldTimestamp) }, secret);
    expect(ok).toBe(false);
  });

  it('rejects when a required header is missing', () => {
    const svixTimestamp = String(Math.floor(Date.now() / 1000));
    expect(verifySvixSignature(body, { svixTimestamp, svixSignature: 'v1,whatever' }, secret)).toBe(false);
  });

  it('accepts when the matching signature is one of several space-separated values', () => {
    const svixId = 'msg_test5';
    const svixTimestamp = String(Math.floor(Date.now() / 1000));
    const real = sign(svixId, svixTimestamp);
    const ok = verifySvixSignature(body, { svixId, svixTimestamp, svixSignature: `v1,bogus== ${real}` }, secret);
    expect(ok).toBe(true);
  });
});
