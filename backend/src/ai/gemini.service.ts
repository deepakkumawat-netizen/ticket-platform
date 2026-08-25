import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GroqService } from './groq.service';

// Thin wrapper over the Gemini REST API — plain fetch, no SDK dependency.
// Request/response shape live-verified against a real key on 2026-08-20
// (both plain text and responseSchema/JSON mode) — see the retry comment
// below for the one wrinkle that showed up doing that.
//
// Falls back to GroqService when Gemini fails and a Groq key is configured
// (2026-08-25) — added after live-testing bulkAssist straight into
// Gemini's free-tier 5-requests/minute cap, where every ticket past the
// first couple silently got no draft. Every existing caller
// (generateText/generateJson) is unchanged; the fallback is entirely
// internal to request() below, so nothing outside this file needed to
// know a second provider exists.
@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  constructor(
    private config: ConfigService,
    private groq: GroqService,
  ) {}

  private get model(): string {
    // Override via GEMINI_MODEL if this default is ever wrong/retired.
    return this.config.get<string>('GEMINI_MODEL') ?? 'gemini-3.7-flash';
  }

  private async request(prompt: string, responseSchema?: object): Promise<string> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      try {
        return await this.requestGemini(prompt, apiKey, responseSchema);
      } catch (err) {
        if (!this.groq.isConfigured) throw err;
        this.logger.warn(`Gemini request failed, falling back to Groq: ${err instanceof Error ? err.message : err}`);
      }
    } else if (!this.groq.isConfigured) {
      throw new BadRequestException('AI features need GEMINI_API_KEY or GROQ_API_KEY configured on the server');
    }
    // Either GEMINI_API_KEY was never set (Groq is the only provider
    // configured) or Gemini just failed above and Groq is the fallback.
    return this.groq.request(prompt, responseSchema);
  }

  private async requestGemini(prompt: string, apiKey: string, responseSchema?: object): Promise<string> {
    // Live testing hit "503 high demand" on the model's first call both
    // times, succeeding immediately on retry — a transient capacity blip,
    // not a real failure. One retry with a short backoff turns that from a
    // user-visible error into nothing they ever notice.
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          ...(responseSchema ? { generationConfig: { responseMimeType: 'application/json', responseSchema } } : {}),
        }),
      });
      if (res.ok) {
        const body = await res.json();
        const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text !== 'string') throw new BadRequestException('Gemini returned no usable content');
        return text;
      }
      lastError = `Gemini request failed (${res.status}): ${await res.text()}`;
      if (res.status !== 503) break; // only retry the transient case
    }
    throw new BadRequestException(lastError ?? 'Gemini request failed');
  }

  /** Plain-text generation — used for drafts/summaries where the shape is just prose. */
  generateText(prompt: string): Promise<string> {
    return this.request(prompt);
  }

  /** JSON generation constrained to `schema` (Gemini's own schema dialect —
   * uppercase type names: OBJECT/STRING/ARRAY/NUMBER/BOOLEAN). If this
   * falls back to Groq, the same schema is translated into a plain-English
   * field list instead (see groq.service.ts) — Groq's JSON mode guarantees
   * valid JSON but not a specific shape the way Gemini's does. */
  async generateJson<T>(prompt: string, schema: object): Promise<T> {
    const text = await this.request(prompt, schema);
    try {
      return JSON.parse(text) as T;
    } catch {
      // Could have come from either provider by this point (see request()'s
      // fallback) — message is deliberately provider-agnostic.
      throw new BadRequestException('AI returned malformed JSON');
    }
  }
}
