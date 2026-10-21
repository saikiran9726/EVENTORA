import { describe, it, expect } from 'vitest';
import { createErrorEnvelope, ErrorEnvelopeSchema } from '@eventora/shared';

describe('Error Envelope Invariant', () => {
  it('should construct and validate conformant error envelope', () => {
    const errorEnvelope = createErrorEnvelope(
      'UNAUTHORIZED_POLICY_VIOLATION',
      'The requested action requires policy event:review',
      'req-4821a-bcde',
      { requiredPolicy: 'event:review', grantedPolicies: [] }
    );

    const parsed = ErrorEnvelopeSchema.safeParse(errorEnvelope);
    expect(parsed.success).toBe(true);
    expect(errorEnvelope.error.code).toBe('UNAUTHORIZED_POLICY_VIOLATION');
    expect(errorEnvelope.error.requestId).toBe('req-4821a-bcde');
    expect(errorEnvelope.error.details.requiredPolicy).toBe('event:review');
  });

  it('should reject malformed error payloads missing requestId or code', () => {
    const malformed = {
      error: {
        message: 'Something went wrong',
      },
    };
    const parsed = ErrorEnvelopeSchema.safeParse(malformed);
    expect(parsed.success).toBe(false);
  });
});
