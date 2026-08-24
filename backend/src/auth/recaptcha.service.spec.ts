import { UnauthorizedException } from '@nestjs/common';
import { RecaptchaService } from './recaptcha.service';

// Same resilience contract as every other third-party integration in this
// codebase (Gemini, SMTP): unconfigured => skip, don't lock people out.

function makeService(secretKey: string | undefined, minScore?: string) {
  const config = { get: jest.fn((key: string) => (key === 'RECAPTCHA_SECRET_KEY' ? secretKey : key === 'RECAPTCHA_MIN_SCORE' ? minScore : undefined)) };
  return new RecaptchaService(config as any);
}

describe('RecaptchaService.verify', () => {
  it('passes through when RECAPTCHA_SECRET_KEY is not configured', async () => {
    const service = makeService(undefined);
    await expect(service.verify(undefined, 'login')).resolves.toBeUndefined();
  });

  it('rejects a missing token once configured', async () => {
    const service = makeService('secret-key');
    await expect(service.verify(undefined, 'login')).rejects.toThrow(UnauthorizedException);
  });

  it('accepts a token that passes with a high score and matching action', async () => {
    global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true, action: 'login', score: 0.9 }) }) as any;
    const service = makeService('secret-key');
    await expect(service.verify('good-token', 'login')).resolves.toBeUndefined();
  });

  it('rejects a token with a low score', async () => {
    global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true, action: 'login', score: 0.1 }) }) as any;
    const service = makeService('secret-key');
    await expect(service.verify('bot-token', 'login')).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a token minted for a different action (can't replay a signup token on login)", async () => {
    global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true, action: 'signup', score: 0.9 }) }) as any;
    const service = makeService('secret-key');
    await expect(service.verify('signup-token', 'login')).rejects.toThrow(UnauthorizedException);
  });

  it("lets the request through if Google's verification endpoint itself is unreachable", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as any;
    const service = makeService('secret-key');
    await expect(service.verify('some-token', 'login')).resolves.toBeUndefined();
  });
});
