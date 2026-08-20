import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Thin wrapper over the Gemini REST API — plain fetch, no SDK dependency.
// Request/response shape live-verified against a real key on 2026-08-20
// (both plain text and responseSchema/JSON mode) — see the retry comment
// below for the one wrinkle that showed up doing that.
@Injectable()
export class GeminiService {
  constructor(private config: ConfigService) {}

  private get apiKey(): string {
    const key = this.config.get<string>('GEMINI_API_KEY');
    if (!key) throw new BadRequestException('AI features need GEMINI_API_KEY configured on the server');
    return key;
  }

  private get model(): string {
    // Override via GEMINI_MODEL if this default is ever wrong/retired.
    return this.config.get<string>('GEMINI_MODEL') ?? 'gemini-3.7-flash';
  }

  private async request(prompt: string, responseSchema?: object): Promise<string> {
    // Live testing hit "503 high demand" on the model's first call both
    // times, succeeding immediately on retry — a transient capacity blip,
    // not a real failure. One retry with a short backoff turns that from a
    // user-visible error into nothing they ever notice.
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`, {
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
   * uppercase type names: OBJECT/STRING/ARRAY/NUMBER/BOOLEAN). */
  async generateJson<T>(prompt: string, schema: object): Promise<T> {
    const text = await this.request(prompt, schema);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new BadRequestException('Gemini returned malformed JSON');
    }
  }
}
