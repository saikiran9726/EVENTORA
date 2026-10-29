import { z } from 'zod';
import { ERROR_CODES, ErrorCode } from './error-codes.js';

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.any()).default({}),
    requestId: z.string(),
  }),
});

export const StrictErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.any()).default({}),
    requestId: z.string(),
  }),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export type StrictErrorEnvelope = z.infer<typeof StrictErrorEnvelopeSchema>;

export function createErrorEnvelope(
  code: ErrorCode | string,
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
