import { IsBoolean, IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';
import { CustomerType, Priority } from '@ticket-platform/shared';

export class CreateEscalationRuleDto {
  @IsIn(Object.values(CustomerType))
  customerType!: CustomerType;

  @IsIn(Object.values(Priority))
  priority!: Priority;

  // Defaults mirror what tickets.service.ts/sla-breach-check.service.ts fall
  // back to when NO rule exists at all for a priority — an explicit rule is
  // only needed to override those defaults, not to opt in to escalation.
  @IsOptional()
  @IsBoolean()
  escalateOnSlaBreach?: boolean = true;

  @IsOptional()
  @IsInt()
  @IsPositive()
  reassignmentThreshold?: number = 2;
}
