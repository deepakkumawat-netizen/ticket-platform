import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Fallback provider, used ONLY through GeminiService's request() — see its
// comment for why. Never called directly by AiService/TicketsService; this
// keeps every existing call site (generateText/generateJson) unchanged
// regardless of which provider actually answered.
//
// Groq's free tier is far more generous than Gemini's (which caps at 5
// requests/minute — see ai.service.ts's bulkAssist, live-tested into that
// wall on 2026-08-25), so this exists specifically to keep AI features
// working through a Gemini rate-limit/outage instead of failing outright.
// Groq's API is OpenAI-compatible (chat completions), not Gemini's own
// request/response shape, hence the translation in request() below.
@Injectable()
export class GroqService {
  constructor(private config: ConfigService) {}

  get isConfigured(): boolean {
    return !!this.config.get<string>('GROQ_API_KEY');
  }

  private get model(): string {
    // Override via GROQ_MODEL if this default is ever retired — same
    // pattern as GEMINI_MODEL. llama-3.3-70b-versatile as of 2026-08-25.
    return this.config.get<string>('GROQ_MODEL') ?? 'llama-3.3-70b-versatile';
  }

  // Same (prompt, optional Gemini-shaped schema) -> raw string contract as
  // GeminiService's own private request() — that symmetry is what lets
  // GeminiService treat this as a drop-in fallback.
  async request(prompt: string, geminiSchema?: object): Promise<string> {
    const apiKey = this.config.get<string>('GROQ_API_KEY');
    if (!apiKey) throw new Error('GROQ_API_KEY not configured');

    // Groq's JSON mode (response_format: json_object) guarantees valid
    // JSON but not a specific shape the way Gemini's responseSchema does —
    // so the shape Gemini would have enforced structurally is spelled out
    // in the prompt text instead. Callers already validate the result
    // against real data afterward (e.g. ai.service.ts's triage checks the
    // returned ticketTypeId is one of the real options), so an
    // occasionally-wrong field is caught there either way.
    const fullPrompt = geminiSchema
      ? `${prompt}\n\nRespond with ONLY a single JSON object (no markdown fencing, no commentary before or after) with exactly these fields:\n${describeSchema(geminiSchema)}`
      : prompt;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: fullPrompt }],
        ...(geminiSchema ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Groq request failed (${res.status}): ${await res.text()}`);
    const body = await res.json();
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('Groq returned no usable content');
    return text;
  }
}

// Turns a Gemini-dialect schema ({type: 'OBJECT', properties: {...}, required: [...]})
// into a plain-English field list Groq can follow without needing Gemini's
// own schema format.
function describeSchema(schema: any): string {
  const properties = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  return Object.entries(properties)
    .map(([key, def]: [string, any]) => {
      const type = String(def?.type ?? 'STRING').toLowerCase();
      const enumHint = Array.isArray(def?.enum) ? ` (one of: ${def.enum.map((v: unknown) => JSON.stringify(v)).join(', ')})` : '';
      return `- "${key}": ${type}${enumHint}${required.has(key) ? ' — required' : ''}`;
    })
    .join('\n');
}
