import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { StaffAuthController } from './staff-auth.controller';
import { PortalAuthController } from './portal-auth.controller';
import { StaffJwtStrategy } from './strategies/staff-jwt.strategy';
import { CustomerJwtStrategy } from './strategies/customer-jwt.strategy';
import { RecaptchaService } from './recaptcha.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_ACCESS_TTL') ?? '15m' },
      }),
    }),
  ],
  controllers: [StaffAuthController, PortalAuthController],
  providers: [AuthService, StaffJwtStrategy, CustomerJwtStrategy, RecaptchaService],
  // RecaptchaService exported so IntakeModule's public lead-form endpoint can
  // reuse the same bot-check instead of a second implementation.
  exports: [AuthService, RecaptchaService],
})
export class AuthModule {}
