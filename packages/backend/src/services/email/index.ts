import { config } from '../../config.js';
import { EmailAdapter } from './adapter.js';
import { ResendEmailAdapter } from './resend-adapter.js';
import { ConsoleEmailAdapter } from './console-adapter.js';
import { TestEmailAdapter, testEmailAdapter } from './test-adapter.js';

export * from './adapter.js';
export * from './suppression.js';
export * from './resend-adapter.js';
export * from './console-adapter.js';
export * from './test-adapter.js';
export * from './templates/index.js';

let activeAdapter: EmailAdapter | null = null;

export function getEmailAdapter(): EmailAdapter {
  if (activeAdapter) return activeAdapter;

  const mode = config.EMAIL_ADAPTER;
  if (mode === 'resend') {
    activeAdapter = new ResendEmailAdapter();
  } else if (mode === 'console') {
    activeAdapter = new ConsoleEmailAdapter();
  } else {
    activeAdapter = testEmailAdapter;
  }

  return activeAdapter;
}

export function setEmailAdapterForTesting(adapter: EmailAdapter | null) {
  activeAdapter = adapter;
}
