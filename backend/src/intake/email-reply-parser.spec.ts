import { parseFromHeader, stripQuotedReplyText } from './email-reply-parser';

describe('parseFromHeader', () => {
  it('parses "Name <email>" shape', () => {
    expect(parseFromHeader('Jane Doe <jane@example.com>')).toEqual({ name: 'Jane Doe', email: 'jane@example.com' });
  });

  it('parses a quoted display name', () => {
    expect(parseFromHeader('"Doe, Jane" <jane@example.com>')).toEqual({ name: 'Doe, Jane', email: 'jane@example.com' });
  });

  it('parses a bare email address with no display name', () => {
    expect(parseFromHeader('jane@example.com')).toEqual({ name: null, email: 'jane@example.com' });
  });

  it('returns nulls for something unparseable', () => {
    expect(parseFromHeader('not an email at all')).toEqual({ name: null, email: null });
  });
});

describe('stripQuotedReplyText', () => {
  it('leaves a plain reply with no quoted history untouched', () => {
    expect(stripQuotedReplyText('Thanks, that fixed it!')).toBe('Thanks, that fixed it!');
  });

  it('truncates at a Gmail-style "On ... wrote:" marker', () => {
    const body = 'Still broken for me.\n\nOn Mon, Jan 1, 2026 at 9:00 AM Support <support@x.com> wrote:\n> Please try restarting.';
    expect(stripQuotedReplyText(body)).toBe('Still broken for me.');
  });

  it('truncates at an Outlook-style "Original Message" marker', () => {
    const body = 'One more thing to add.\n-----Original Message-----\nFrom: Support';
    expect(stripQuotedReplyText(body)).toBe('One more thing to add.');
  });

  it('truncates at the first quoted (">") line', () => {
    const body = "It's working now, thanks.\n> Did you try restarting?\n> - Support";
    expect(stripQuotedReplyText(body)).toBe("It's working now, thanks.");
  });
});
