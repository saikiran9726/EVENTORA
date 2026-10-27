export interface EmailTag {
  name: string;
  value: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  tags?: EmailTag[];
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

export interface SendEmailResult {
  id: string;
  to: string[];
  accepted: boolean;
  skipped?: boolean;
  rejectedReason?: string;
}

export interface EmailAdapter {
  send(options: SendEmailOptions): Promise<SendEmailResult>;
  sendBatch(options: SendEmailOptions[]): Promise<SendEmailResult[]>;
}
