// Google's terms allow hiding the floating reCAPTCHA badge (see
// .grecaptcha-badge in styles.css) only if this disclosure is shown near
// whatever form it's protecting — required wording, don't reword it.
export function RecaptchaDisclosure() {
  return (
    <p className="recaptcha-disclosure">
      This site is protected by reCAPTCHA and the Google{' '}
      <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
        Privacy Policy
      </a>{' '}
      and{' '}
      <a href="https://policies.google.com/terms" target="_blank" rel="noreferrer">
        Terms of Service
      </a>{' '}
      apply.
    </p>
  );
}
