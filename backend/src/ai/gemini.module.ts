import { Module } from '@nestjs/common';
import { GeminiService } from './gemini.service';

// Split out from AiModule so TicketsService can also depend on GeminiService
// directly (for auto-assign's "pick the best agent" call) without creating a
// circular module dependency — AiModule already imports TicketsModule (for
// draftReply/insights), so TicketsModule importing AiModule back would be
// circular. GeminiService itself has no dependencies beyond ConfigService,
// so it splits out cleanly.
@Module({
  providers: [GeminiService],
  exports: [GeminiService],
})
export class GeminiModule {}
