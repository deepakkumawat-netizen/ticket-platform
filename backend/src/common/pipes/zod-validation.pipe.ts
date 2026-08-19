import { ArgumentMetadata, BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodTypeAny } from 'zod';

// Wraps a shared Zod schema (from @ticket-platform/shared) as a Nest pipe,
// so field-definition payloads are validated with the EXACT same schema the
// frontend's DynamicFormRenderer and TicketTypeVersion snapshots use — one
// definition, not a parallel class-validator DTO that could drift from it.
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodTypeAny) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return result.data;
  }
}
