import { IsIn, IsInt, IsPositive } from 'class-validator';
import { CustomerType, Priority } from '@ticket-platform/shared';

export class CreateSlaRuleDto {
  @IsIn(Object.values(CustomerType))
  customerType!: CustomerType;

  @IsIn(Object.values(Priority))
  priority!: Priority;

  @IsInt()
  @IsPositive()
  responseTimeMinutes!: number;

  @IsInt()
  @IsPositive()
  resolutionTimeMinutes!: number;
}
