import crypto from 'crypto';
import { EmailAdapter, SendEmailOptions, SendEmailResult } from './adapter.js';
import { filterSuppressedEmails } from './suppression.js';

export interface RecordedEmail extends SendEmailOptions {
  id: string;
  sentAt: Date;
}

export class TestEmailAdapter implements EmailAdapter {
  private sentEmails: RecordedEmail[] = [];
  private failNextCount = 0;
  private failError: Error | null = null;

  setFailNext(count: number, error = new Error('PROVIDER_500_SIMULATED_OUTAGE')) {
    this.failNextCount = count;
    this.failError = error;
  }

  getSentEmails(): RecordedEmail[] {
    return [...this.sentEmails];
  }

  getLastEmail(): RecordedEmail | undefined {
    return this.sentEmails[this.sentEmails.length - 1];
  }

  findEmailTo(recipient: string): RecordedEmail | undefined {
    const norm = recipient.trim().toLowerCase();
    return this.sentEmails.find((e) => {
      const toArr = Array.isArray(e.to) ? e.to : [e.to];
      return toArr.some((t) => t.trim().toLowerCase() === norm);
    });
  }

  findEmailsBySubject(substr: string): RecordedEmail[] {
    return this.sentEmails.filter((e) => e.subject.toLowerCase().includes(substr.toLowerCase()));
  }

  clear() {
    this.sentEmails = [];
    this.failNextCount = 0;
    this.failError = null;
  }

  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    if (this.failNextCount > 0) {
      this.failNextCount--;
      throw this.failError || new Error('PROVIDER_500_SIMULATED_OUTAGE');
    }

    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    const { allowed } = await filterSuppressedEmails(recipients);

    if (allowed.length === 0) {
      return {
        id: `suppressed_${crypto.randomUUID()}`,
        to: recipients,
        accepted: false,
        skipped: true,
        rejectedReason: 'RECIPIENT_SUPPRESSED',
      };
    }

    const id = `test_${crypto.randomUUID()}`;
    const recorded: RecordedEmail = {
      ...options,
      to: allowed,
      id,
      sentAt: new Date(),
    };

    this.sentEmails.push(recorded);

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

// Global test adapter singleton for test suite interception
export const testEmailAdapter = new TestEmailAdapter();
