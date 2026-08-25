import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CommentVisibility } from '@prisma/client';

export class CreateCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body: string;

  // Staff-only choice: INTERNAL (agent notes, never shown to the requester)
  // vs PUBLIC (visible on the employee's own /my-tickets view too). Omitted
  // entirely on the employee-facing route (tickets.controller.ts's
  // addMyComment) — an employee's own comment is always PUBLIC, forced
  // server-side, not client-supplied.
  @IsOptional()
  @IsEnum(CommentVisibility)
  visibility?: CommentVisibility;
}
