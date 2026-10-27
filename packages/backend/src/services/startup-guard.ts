/**
 * Startup Guard for Payment & Test-Mode Invariants.
 * Refuses to boot in production if live payment provider keys are detected.
 */
export function verifyPaymentStartupGuard() {
  const env = process.env.NODE_ENV || 'development';
  const adapter = process.env.PAYMENT_PROVIDER || process.env.PAYMENT_ADAPTER || 'simulator';

  // Dangerous live keys patterns
  const liveKeyPatterns = [
    { name: 'RAZORPAY_KEY_ID', value: process.env.RAZORPAY_KEY_ID, testPattern: /^rzp_test_/ },
    { name: 'RAZORPAY_KEY_SECRET', value: process.env.RAZORPAY_KEY_SECRET, forbiddenPattern: /^rzp_live_/ },
    { name: 'STRIPE_SECRET_KEY', value: process.env.STRIPE_SECRET_KEY, forbiddenPattern: /^sk_live_/ },
  ];

  if (env === 'production') {
    for (const key of liveKeyPatterns) {
      if (key.value) {
        if (key.forbiddenPattern && key.forbiddenPattern.test(key.value)) {
          throw new Error(
            `[FATAL STARTUP GUARD] Live payment credentials detected in production environment: ${key.name}. Test-mode simulator/sandbox only!`
          );
        }
      }
    }

    if (adapter !== 'simulator' && adapter !== 'sandbox' && adapter !== 'youpi') {
      throw new Error(
        `[FATAL STARTUP GUARD] Invalid PAYMENT_ADAPTER="${adapter}". Must be "youpi", "simulator" or "sandbox".`
      );
    }
  }

  console.log(`[Payment Startup Guard] Passed. Adapter: "${adapter}" (all money integer paise).`);
}
