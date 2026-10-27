import { config } from '../../../config.js';

/**
 * Formats a timestamp into Indian Standard Time (IST - Asia/Kolkata).
 */
export function formatIST(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  if (isNaN(d.getTime())) return String(date);

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d) + ' IST';
}

/**
 * Formats integer paise into Indian Rupee symbol (₹) currency string.
 */
export function formatRupees(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Clean, modern responsive email wrapper matching Eventora brand standards.
 */
export function emailLayout(options: {
  title: string;
  contentHtml: string;
  contentText: string;
  unsubscribeUrl?: string;
  preheader?: string;
}): { html: string; text: string } {
  const appHost = config.APP_HOST;
  const unsubscribeFooter = options.unsubscribeUrl
    ? `<p style="margin-top: 24px; font-size: 12px; color: #64748b; text-align: center;">
        You received this email because of your notification settings. 
        <a href="${options.unsubscribeUrl}" style="color: #4f46e5; text-decoration: underline;">Manage preferences or unsubscribe</a>.
       </p>`
    : `<p style="margin-top: 24px; font-size: 12px; color: #64748b; text-align: center;">
        This is an essential transactional notification from Eventora (${appHost}).
       </p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; color: #0f172a; }
    .container { max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 24px 32px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
    .content { padding: 32px; }
    .btn { display: inline-block; background-color: #4f46e5; color: #ffffff !important; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px; margin: 20px 0; }
    .footer { padding: 20px 32px; background-color: #f1f5f9; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  ${options.preheader ? `<div style="display: none; max-height: 0px; overflow: hidden;">${options.preheader}</div>` : ''}
  <div class="container">
    <div class="header">
      <h1>Eventora</h1>
    </div>
    <div class="content">
      ${options.contentHtml}
    </div>
    <div class="footer">
      <p style="margin: 0;">© ${new Date().getFullYear()} Eventora Campus Platform. All rights reserved.</p>
      ${unsubscribeFooter}
    </div>
  </div>
</body>
</html>`;

  const text = `${options.title.toUpperCase()} - Eventora
========================================

${options.contentText}

----------------------------------------
© ${new Date().getFullYear()} Eventora Campus Platform (${appHost})
${options.unsubscribeUrl ? `Preferences / Unsubscribe: ${options.unsubscribeUrl}` : 'Transactional notification'}`;

  return { html, text };
}
