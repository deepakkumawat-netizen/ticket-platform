import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Thin wrapper over the Gemini REST API — plain fetch, no SDK dependency.
// Verified directly against https://ai.google.dev/api/generate-content
// (2026-08-20) rather than assumed from training data, since this API
// surface has moved fast (the SDK itself now also exposes a newer
// `interactions.create` shape) — this raw endpoint is the stable part.
// UNTESTED against a live key as of writing (none was available yet) — if
// the exact request/response shape has drifted, this is the one file to fix.
@Injectable()
export class GeminiService {
  constructor(private config: ConfigService) {}

  private get apiKey(): string {
    const key = this.config.get<string>('GEMINI_API_KEY');
    if (!key) throw new BadRequestException('AI features need GEMINI_API_KEY configured on the server');
    return key;
  }

  private get model(): string {
    // Override via GEMINI_MODEL if this default is ever wrong/retired —
    // see the comment above about how fast this API has been moving.
    return this.config.get<string>('GEMINI_MODEL') ?? 'gemini-3.7-flash';
  }

  private async request(prompt: string, responseSchema?: object): Promise<string> {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        ...(responseSchema ? { generationConfig: { responseMimeType: 'application/json', responseSchema } } : {}),
      }),
    });
    if (!res.ok) {
      throw new BadRequestException(`Gemini request failed (${res.status}): ${await res.text()}`);
    }
    const body = await res.json();
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') throw new BadRequestException('Gemini returned no usable content');
    return text;
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
