import { IsIn, IsOptional } from 'class-validator';
import { IntakeQueryStatus } from '@ticket-platform/shared';

export class ListIntakeQueriesQueryDto {
  // Defaults to PENDING in the service — that's the actual triage queue;
  // pass ?status=CONVERTED or ?status=REJECTED to see history instead.
  @IsOptional()
  @IsIn(Object.values(IntakeQueryStatus))
  status?: IntakeQueryStatus;
}
