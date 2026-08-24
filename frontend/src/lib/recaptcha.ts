// Invisible bot-check (Google reCAPTCHA v3) for the staff/portal login and
// signup forms — see backend/src/auth/recaptcha.service.ts for verification.
// Resolves to undefined if VITE_RECAPTCHA_SITE_KEY isn't set at build time,
// same resilience pattern as the backend skipping verification when
// RECAPTCHA_SECRET_KEY is unset — login/signup never break just because
// this hasn't been configured yet.
const SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

declare global {
  interface Window {
    grecaptcha?: {
      ready: (callback: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.grecaptcha) return resolve();
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${SITE_KEY}`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load reCAPTCHA'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Returns a token scoped to `action` (must match the string
 * RecaptchaService.verify() is called with on the backend for that same
 * request), or undefined if reCAPTCHA isn't configured or fails to load —
 * callers should submit without it in that case. */
export async function getRecaptchaToken(action: string): Promise<string | undefined> {
  if (!SITE_KEY) return undefined;
  try {
    await loadScript();
    return await new Promise<string>((resolve, reject) => {
      window.grecaptcha!.ready(() => {
        window.grecaptcha!.execute(SITE_KEY, { action }).then(resolve).catch(reject);
      });
    });
  } catch {
    return undefined;
  }
}
