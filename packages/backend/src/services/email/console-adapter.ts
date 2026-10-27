import crypto from 'crypto';
import { EmailAdapter, SendEmailOptions, SendEmailResult } from './adapter.js';
import { filterSuppressedEmails } from './suppression.js';

export class ConsoleEmailAdapter implements EmailAdapter {
  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    const { allowed, suppressed } = await filterSuppressedEmails(recipients);

    if (allowed.length === 0) {
      console.log(`[ConsoleEmailAdapter] Suppressed send to: ${suppressed.join(', ')}`);
      return {
        id: `suppressed_${crypto.randomUUID()}`,
        to: recipients,
        accepted: false,
        skipped: true,
        rejectedReason: 'RECIPIENT_SUPPRESSED',
      };
    }

    const id = `console_${crypto.randomUUID()}`;
    console.log(`[ConsoleEmailAdapter] ✉️ Email Sent: [ID: ${id}]`);
    console.log(`  To: ${allowed.join(', ')}`);
    console.log(`  Subject: ${options.subject}`);
    console.log(`  Preview: ${(options.text || options.html).slice(0, 120)}...`);

    return {
      id,
      to: allowed,
      accepted: true,
    };
  }

  async sendBatch(optionsList: SendEmailOptions[]): Promise<SendEmailResult[]> {
    const results: SendEmailResult[] = [];
    for (const opt of optionsList) {
      results.push(await this.send(opt));
    }
    return results;
  }
}
