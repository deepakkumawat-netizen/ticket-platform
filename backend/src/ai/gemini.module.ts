import { Module } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { GroqService } from './groq.service';

// Split out from AiModule so TicketsService can also depend on GeminiService
// directly (for auto-assign's "pick the best agent" call) without creating a
// circular module dependency — AiModule already imports TicketsModule (for
// draftReply/insights), so TicketsModule importing AiModule back would be
// circular. GeminiService itself has no dependencies beyond ConfigService,
// so it splits out cleanly.
//
// GroqService lives here too (not its own module) — it's only ever used as
// GeminiService's internal fallback (see gemini.service.ts), nothing else
// injects it directly, so it doesn't need to be exported.
@Module({
  providers: [GeminiService, GroqService],
  exports: [GeminiService],
})
export class GeminiModule {}
