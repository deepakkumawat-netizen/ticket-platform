import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

// No `customerType` field here — that's deliberately not stored on Customer
// (see schema.prisma). It's derived at ticket-creation time from whether
// companyId is set, so it can never drift from the actual relation.
export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  // If provided, the customer is created (or attached) as a contact under a
  // B2B Company with this name — found by name within the org, or created if
  // it doesn't exist yet. Omit for a standalone B2C customer.
  @IsOptional()
  @IsString()
  companyName?: string;
}
