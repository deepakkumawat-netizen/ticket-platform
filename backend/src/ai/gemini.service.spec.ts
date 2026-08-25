import { BadRequestException } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { GroqService } from './groq.service';

// Covers request()'s fallback branching specifically -- the rest of
// GeminiService (the actual prompt-building call sites in ai.service.ts/
// tickets.service.ts) has no unit tests by design, verified live against a
// real key instead. This branching earns its own tests: which provider
// gets tried, in what order, and when it gives up vs. falls through.

function makeConfig(values: Record<string, string | undefined>) {
  return { get: jest.fn((key: string) => values[key]) };
}

function geminiOk(text: string) {
  return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
}
function geminiFail(status: number) {
  return { ok: false, status, text: async () => `boom ${status}` };
}

describe('GeminiService.request fallback', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  it('uses Gemini directly when it succeeds, never touching Groq', async () => {
    fetchMock.mockResolvedValue(geminiOk('hello from gemini'));
    const groq = { isConfigured: true, request: jest.fn() } as unknown as GroqService;
    const service = new GeminiService(makeConfig({ GEMINI_API_KEY: 'g-key' }) as any, groq);
    await expect(service.generateText('hi')).resolves.toBe('hello from gemini');
    expect(groq.request).not.toHaveBeenCalled();
  });

  it('falls back to Groq when Gemini fails and Groq is configured', async () => {
    fetchMock.mockResolvedValue(geminiFail(429)); // no retry for non-503, fails immediately
    const groq = { isConfigured: true, request: jest.fn().mockResolvedValue('hello from groq') } as unknown as GroqService;
    const service = new GeminiService(makeConfig({ GEMINI_API_KEY: 'g-key' }) as any, groq);
    await expect(service.generateText('hi')).resolves.toBe('hello from groq');
    expect(groq.request).toHaveBeenCalledWith('hi', undefined);
  });

  it('re-throws the original Gemini error when Groq is not configured either', async () => {
    fetchMock.mockResolvedValue(geminiFail(500));
    const groq = { isConfigured: false, request: jest.fn() } as unknown as GroqService;
    const service = new GeminiService(makeConfig({ GEMINI_API_KEY: 'g-key' }) as any, groq);
    await expect(service.generateText('hi')).rejects.toBeInstanceOf(BadRequestException);
    expect(groq.request).not.toHaveBeenCalled();
  });

  it('goes straight to Groq (never calls Gemini) when GEMINI_API_KEY is unset but Groq is configured', async () => {
    const groq = { isConfigured: true, request: jest.fn().mockResolvedValue('groq only') } as unknown as GroqService;
    const service = new GeminiService(makeConfig({}) as any, groq);
    await expect(service.generateText('hi')).resolves.toBe('groq only');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws a clean error when neither provider is configured', async () => {
    const groq = { isConfigured: false, request: jest.fn() } as unknown as GroqService;
    const service = new GeminiService(makeConfig({}) as any, groq);
    await expect(service.generateText('hi')).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes the schema through to Groq so it can describe the expected shape', async () => {
    fetchMock.mockResolvedValue(geminiFail(429));
    const groq = { isConfigured: true, request: jest.fn().mockResolvedValue('{"ok":true}') } as unknown as GroqService;
    const service = new GeminiService(makeConfig({ GEMINI_API_KEY: 'g-key' }) as any, groq);
    const schema = { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } } };
    await expect(service.generateJson('hi', schema)).resolves.toEqual({ ok: true });
    expect(groq.request).toHaveBeenCalledWith('hi', schema);
  });

  it('retries once on a transient 503 before giving up on Gemini', async () => {
    fetchMock.mockResolvedValueOnce(geminiFail(503)).mockResolvedValueOnce(geminiOk('recovered'));
    const groq = { isConfigured: true, request: jest.fn() } as unknown as GroqService;
    const service = new GeminiService(makeConfig({ GEMINI_API_KEY: 'g-key' }) as any, groq);
    await expect(service.generateText('hi')).resolves.toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(groq.request).not.toHaveBeenCalled();
  }, 10_000);
});
