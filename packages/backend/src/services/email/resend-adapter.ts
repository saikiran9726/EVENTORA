import crypto from 'crypto';
import { Resend } from 'resend';
import { config } from '../../config.js';
import { EmailAdapter, SendEmailOptions, SendEmailResult } from './adapter.js';
import { filterSuppressedEmails } from './suppression.js';

export class ResendEmailAdapter implements EmailAdapter {
  private resend: Resend;

  constructor(apiKey?: string) {
    const key = apiKey || config.RESEND_API_KEY;
    if (!key && config.NODE_ENV === 'production') {
      console.warn('[ResendEmailAdapter] Warning: RESEND_API_KEY is not set.');
    }
    this.resend = new Resend(key || 're_placeholder_development_key');
  }

  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    const { allowed, suppressed } = await filterSuppressedEmails(recipients);

    if (allowed.length === 0) {
      console.warn(`[ResendEmailAdapter] Suppressed send to: ${suppressed.join(', ')}`);
      return {
        id: `suppressed_${crypto.randomUUID()}`,
        to: recipients,
        accepted: false,
        skipped: true,
        rejectedReason: 'RECIPIENT_SUPPRESSED',
      };
    }

    const headers: Record<string, string> = { ...(options.headers || {}) };
    if (options.idempotencyKey) {
      headers['X-Entity-Ref-ID'] = options.idempotencyKey;
    }

    const payload: any = {
      from: options.from || config.EMAIL_FROM,
      to: allowed,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      tags: options.tags,
    };

    const res = await this.resend.emails.send(payload);

    if (res.error) {
      const errMessage = res.error.message || 'Resend delivery failed';
      console.error('[ResendEmailAdapter] Send error:', res.error);
      throw new Error(`RESEND_ERROR: ${errMessage}`);
    }

    return {
      id: res.data?.id || `resend_${crypto.randomUUID()}`,
      to: allowed,
      accepted: true,
    };
  }

  async sendBatch(optionsList: SendEmailOptions[]): Promise<SendEmailResult[]> {
    if (optionsList.length === 0) return [];

    const results: SendEmailResult[] = [];
    const BATCH_CHUNK_SIZE = 100; // Resend batch API limit is 100 emails

    for (let i = 0; i < optionsList.length; i += BATCH_CHUNK_SIZE) {
      const slice = optionsList.slice(i, i + BATCH_CHUNK_SIZE);
      const batchPayloads: any[] = [];
      const batchIndices: { originalIndex: number; to: string[] }[] = [];

      for (let j = 0; j < slice.length; j++) {
        const item = slice[j];
        const recipients = Array.isArray(item.to) ? item.to : [item.to];
        const { allowed } = await filterSuppressedEmails(recipients);

        if (allowed.length === 0) {
          results.push({
            id: `suppressed_${crypto.randomUUID()}`,
            to: recipients,
            accepted: false,
            skipped: true,
            rejectedReason: 'RECIPIENT_SUPPRESSED',
          });
          continue;
        }

        const headers: Record<string, string> = { ...(item.headers || {}) };
        if (item.idempotencyKey) {
          headers['X-Entity-Ref-ID'] = item.idempotencyKey;
        }

        batchPayloads.push({
          from: item.from || config.EMAIL_FROM,
          to: allowed,
          subject: item.subject,
          html: item.html,
          text: item.text,
          replyTo: item.replyTo,
          headers: Object.keys(headers).length > 0 ? headers : undefined,
          tags: item.tags,
        });

        batchIndices.push({ originalIndex: j, to: allowed });
      }

      if (batchPayloads.length > 0) {
        const batchRes = await this.resend.batch.send(batchPayloads);

        if (batchRes.error) {
          console.error('[ResendEmailAdapter] Batch error:', batchRes.error);
          throw new Error(`RESEND_BATCH_ERROR: ${batchRes.error.message}`);
        }

        const items = batchRes.data?.data || [];
        for (let k = 0; k < batchPayloads.length; k++) {
          const sentItem = items[k];
          results.push({
            id: sentItem?.id || `resend_${crypto.randomUUID()}`,
            to: batchIndices[k].to,
            accepted: true,
          });
        }
      }
    }

    return results;
  }
}
