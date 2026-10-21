import { z } from 'zod';

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.any()).default({}),
    requestId: z.string(),
  }),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export function createErrorEnvelope(
  code: string,
  message: string,
  requestId: string,
  details: Record<string, any> = {}
): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      details,
      requestId,
    },
  };
}
