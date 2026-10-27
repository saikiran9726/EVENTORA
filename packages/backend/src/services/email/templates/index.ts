import { emailLayout, formatIST, formatRupees } from './common.js';
import { SendEmailOptions } from '../adapter.js';

export * from './common.js';

/**
 * 1. Auth: Verify Email
 */
export function buildVerifyEmailTemplate(params: {
  to: string;
  name: string;
  verificationUrl: string;
  expiresAt?: Date | string;
}): SendEmailOptions {
  const expiresText = params.expiresAt ? ` This link expires on ${formatIST(params.expiresAt)}.` : '';
  const contentHtml = `
    <h2 style="color: #1e293b; margin-top: 0;">Verify your email address</h2>
    <p>Hello ${params.name || 'there'},</p>
    <p>Welcome to Eventora! Please click the button below to verify your email address and activate your student account.${expiresText}</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.verificationUrl}" class="btn">Verify Email Address</a>
    </div>
    <p style="font-size: 14px; color: #64748b;">Or paste this link into your browser:<br/>
      <a href="${params.verificationUrl}" style="color: #4f46e5; word-break: break-all;">${params.verificationUrl}</a>
    </p>
  `;

  const contentText = `Hello ${params.name || 'there'},

Welcome to Eventora! Please verify your email address to activate your account.${expiresText}

Verify link: ${params.verificationUrl}`;

  const { html, text } = emailLayout({
    title: 'Verify Your Email - Eventora',
    contentHtml,
    contentText,
  });

  return {
    to: params.to,
    subject: 'Verify your email for Eventora',
    html,
    text,
  };
}

/**
 * 2. Auth: Reset Password
 */
export function buildResetPasswordTemplate(params: {
  to: string;
  name: string;
  resetUrl: string;
  expiresAt?: Date | string;
}): SendEmailOptions {
  const expiresText = params.expiresAt ? ` This link expires on ${formatIST(params.expiresAt)}.` : ' This link expires in 1 hour.';
  const contentHtml = `
    <h2 style="color: #1e293b; margin-top: 0;">Reset your password</h2>
    <p>Hello ${params.name || 'there'},</p>
    <p>We received a request to reset your Eventora account password.${expiresText}</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.resetUrl}" class="btn">Reset Password</a>
    </div>
    <p style="font-size: 14px; color: #64748b;">If you did not request this, you can safely ignore this email. Your password will not change.</p>
  `;

  const contentText = `Hello ${params.name || 'there'},

We received a request to reset your Eventora account password.${expiresText}

Reset link: ${params.resetUrl}

If you did not request this, you can safely ignore this email.`;

  const { html, text } = emailLayout({
    title: 'Reset Password - Eventora',
    contentHtml,
    contentText,
  });

  return {
    to: params.to,
    subject: 'Reset your Eventora password',
    html,
    text,
  };
}

/**
 * 3. Booking: Confirmed
 */
export function buildBookingConfirmedTemplate(params: {
  to: string;
  name: string;
  eventTitle: string;
  bookingRef: string;
  ticketUrl: string;
  startsAt: Date | string;
  venueName?: string;
  quantity?: number;
  pricePaise?: number;
}): SendEmailOptions {
  const formattedPrice = params.pricePaise !== undefined ? formatRupees(params.pricePaise) : 'Free';
  const contentHtml = `
    <h2 style="color: #1e293b; margin-top: 0;">🎉 You're going to ${params.eventTitle}!</h2>
    <p>Hello ${params.name || 'there'},</p>
    <p>Your booking has been confirmed. Below are your event and ticket details:</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
      <tr><td style="padding: 10px 16px; font-weight: bold; width: 35%;">Booking Reference:</td><td style="padding: 10px 16px;">${params.bookingRef}</td></tr>
      <tr><td style="padding: 10px 16px; font-weight: bold;">Event:</td><td style="padding: 10px 16px;">${params.eventTitle}</td></tr>
      <tr><td style="padding: 10px 16px; font-weight: bold;">Date & Time:</td><td style="padding: 10px 16px;">${formatIST(params.startsAt)}</td></tr>
      ${params.venueName ? `<tr><td style="padding: 10px 16px; font-weight: bold;">Venue:</td><td style="padding: 10px 16px;">${params.venueName}</td></tr>` : ''}
      <tr><td style="padding: 10px 16px; font-weight: bold;">Total Amount:</td><td style="padding: 10px 16px;">${formattedPrice}</td></tr>
    </table>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${params.ticketUrl}" class="btn">View & Download Tickets</a>
    </div>
  `;

  const contentText = `Hello ${params.name || 'there'},

Your booking has been confirmed for ${params.eventTitle}!

Booking Reference: ${params.bookingRef}
Date & Time: ${formatIST(params.startsAt)}
${params.venueName ? `Venue: ${params.venueName}\n` : ''}Total Amount: ${formattedPrice}

View Tickets: ${params.ticketUrl}`;

  const { html, text } = emailLayout({
    title: `Booking Confirmed: ${params.eventTitle}`,
    contentHtml,
    contentText,
  });

  return {
    to: params.to,
    subject: `Booking Confirmed: ${params.eventTitle}`,
    html,
    text,
  };
}

/**
 * 4. Payment: Receipt
 */
export function buildPaymentReceiptTemplate(params: {
  to: string;
  name: string;
  paymentId: string;
  utr?: string;
  eventTitle: string;
  amountPaise: number;
  paidAt: Date | string;
  invoiceUrl?: string;
}): SendEmailOptions {
  const contentHtml = `
    <h2 style="color: #1e293b; margin-top: 0;">Payment Receipt</h2>
    <p>Hello ${params.name || 'there'},</p>
    <p>Thank you for your payment. Here is your official receipt for <strong>${params.eventTitle}</strong>:</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
      <tr><td style="padding: 10px 16px; font-weight: bold; width: 35%;">Payment ID:</td><td style="padding: 10px 16px;">${params.paymentId}</td></tr>
      ${params.utr ? `<tr><td style="padding: 10px 16px; font-weight: bold;">UPI / UTR:</td><td style="padding: 10px 16px;">${params.utr}</td></tr>` : ''}
      <tr><td style="padding: 10px 16px; font-weight: bold;">Amount Paid:</td><td style="padding: 10px 16px; color: #16a34a; font-weight: bold;">${formatRupees(params.amountPaise)}</td></tr>
      <tr><td style="padding: 10px 16px; font-weight: bold;">Paid On:</td><td style="padding: 10px 16px;">${formatIST(params.paidAt)}</td></tr>
      <tr><td style="padding: 10px 16px; font-weight: bold;">Status:</td><td style="padding: 10px 16px;">SUCCESSFUL</td></tr>
    </table>
    ${params.invoiceUrl ? `<div style="text-align: center; margin: 20px 0;"><a href="${params.invoiceUrl}" class="btn">Download Invoice</a></div>` : ''}
  `;

  const contentText = `Hello ${params.name || 'there'},

Payment Receipt for ${params.eventTitle}

Payment ID: ${params.paymentId}
${params.utr ? `UTR: ${params.utr}\n` : ''}Amount: ${formatRupees(params.amountPaise)}
Date: ${formatIST(params.paidAt)}
Status: SUCCESSFUL
${params.invoiceUrl ? `Invoice: ${params.invoiceUrl}` : ''}`;

  const { html, text } = emailLayout({
    title: `Payment Receipt: ${params.eventTitle}`,
    contentHtml,
    contentText,
  });

  return {
    to: params.to,
    subject: `Payment Receipt: ${params.eventTitle}`,
    html,
    text,
  };
}

/**
 * 5. Payment: Verification Queue
 */
export function buildPaymentVerificationQueueTemplate(params: {
  to: string;
  name: string;
  eventTitle: string;
  amountPaise: number;
  utr?: string;
  queuePosition?: number;
  statusUrl: string;
}): SendEmailOptions {
  const contentHtml = `
    <h2 style="color: #1e293b; margin-top: 0;">Payment Under Verification</h2>
    <p>Hello ${params.name || 'there'},</p>
    <p>Your payment submission of <strong>${formatRupees(params.amountPaise)}</strong> for <strong>${params.eventTitle}</strong> is currently being reviewed in our payment verification queue.</p>
    ${params.utr ? `<p><strong>UTR:</strong> ${params.utr}</p>` : ''}
    ${params.queuePosition ? `<p><strong>Current Queue Position:</strong> #${params.queuePosition}</p>` : ''}
    <p>Most transactions are reconciled automatically within a few minutes. If manual review is required by the organizer, it may take up to 2 hours.</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${params.statusUrl}" class="btn">Check Verification Status</a>
    </div>
  `;

  const contentText = `Hello ${params.name || 'there'},

Your payment of ${formatRupees(params.amountPaise)} for ${params.eventTitle} is currently in the verification queue.
${params.utr ? `UTR: ${params.utr}\n` : ''}${params.queuePosition ? `Queue Position: #${params.queuePosition}\n` : ''}
Check status: ${params.statusUrl}`;

  const { html, text } = emailLayout({
    title: `Payment In Verification: ${params.eventTitle}`,
    contentHtml,
    contentText,
  });

  return {
    to: params.to,
    subject: `Payment Verification Pending: ${params.eventTitle}`,
    html,
    text,
  };
}

/**
 * 6. Booking: Cancelled
 */
export function buildBookingCancelledTemplate(params: {
  to: string;
  name: string;
  eventTitle: string;
  bookingRef: string;
  refundStatus?: string;
  refundAmountPaise?: number;
  cancelledAt: Date | string;
}): SendEmailOptions {
  const refundInfo = params.refundAmountPaise
    ? `<p>A refund of <strong>${formatRupees(params.refundAmountPaise)}</strong> has been initiated (Status: ${params.refundStatus || 'PROCESSING'}).</p>`
    : '<p>No charges were incurred for this registration.</p>';

  const contentHtml = `
    <h2 style="color: #1e293b; margin-top: 0;">Booking Cancelled</h2>
    <p>Hello ${params.name || 'there'},</p>
    <p>Your booking (Ref: <strong>${params.bookingRef}</strong>) for <strong>${params.eventTitle}</strong> has been cancelled on ${formatIST(params.cancelledAt)}.</p>
    ${refundInfo}
  `;

  const contentText = `Hello ${params.name || 'there'},

Your booking (${params.bookingRef}) for ${params.eventTitle} has been cancelled on ${formatIST(params.cancelledAt)}.
${params.refundAmountPaise ? `Refund: ${formatRupees(params.refundAmountPaise)} (${params.refundStatus || 'PROCESSING'})` : 'No charges incurred.'}`;

  const { html, text } = emailLayout({
    title: `Booking Cancelled: ${params.eventTitle}`,
    contentHtml,
    contentText,
  });

  return {
    to: params.to,
    subject: `Booking Cancelled: ${params.eventTitle}`,
    html,
    text,
  };
}

/**
 * 7. Waitlist: Offer Dispatched
 */
export function buildWaitlistOfferTemplate(params: {
  to: string;
  name: string;
  eventTitle: string;
  claimUrl: string;
  expiresAt: Date | string;
  tierName?: string;
}): SendEmailOptions {
  const contentHtml = `
    <h2 style="color: #1e293b; margin-top: 0;">🎉 A spot just opened up!</h2>
    <p>Hello ${params.name || 'there'},</p>
    <p>Good news! A ticket is now available for you for <strong>${params.eventTitle}</strong>${params.tierName ? ` (${params.tierName})` : ''}.</p>
    <p style="color: #dc2626; font-weight: bold;">⚡ This offer expires on ${formatIST(params.expiresAt)}.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.claimUrl}" class="btn">Claim Your Spot Now</a>
    </div>
    <p style="font-size: 14px; color: #64748b;">If you don't claim your spot before the deadline, it will automatically be released to the next person on the waitlist.</p>
  `;

  const contentText = `Hello ${params.name || 'there'},

A spot opened up for ${params.eventTitle}!
Offer expires: ${formatIST(params.expiresAt)}

Claim link: ${params.claimUrl}`;

  const { html, text } = emailLayout({
    title: `Spot Available: ${params.eventTitle}`,
    contentHtml,
    contentText,
  });

  return {
    to: params.to,
    subject: `Spot Available! Claim your ticket for ${params.eventTitle}`,
    html,
    text,
  };
}

/**
 * 8. Team: Invite
 */
export function buildTeamInviteTemplate(params: {
  to: string;
  inviteeName?: string;
  inviterName: string;
  teamName: string;
  eventTitle: string;
  joinUrl: string;
}): SendEmailOptions {
  const contentHtml = `
    <h2 style="color: #1e293b; margin-top: 0;">Team Invitation</h2>
    <p>Hello ${params.inviteeName || 'there'},</p>
    <p><strong>${params.inviterName}</strong> has invited you to join team <strong>${params.teamName}</strong> for <strong>${params.eventTitle}</strong>.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.joinUrl}" class="btn">Accept & Join Team</a>
    </div>
  `;

  const contentText = `Hello ${params.inviteeName || 'there'},

${params.inviterName} has invited you to join team "${params.teamName}" for ${params.eventTitle}.

Join link: ${params.joinUrl}`;

  const { html, text } = emailLayout({
    title: `Team Invitation: ${params.teamName}`,
    contentHtml,
    contentText,
  });

  return {
    to: params.to,
    subject: `You have been invited to join team ${params.teamName} on Eventora`,
    html,
    text,
  };
}

/**
 * 9. Event Lifecycle: Changed / Postponed / Cancelled
 */
export function buildEventStatusChangeTemplate(params: {
  to: string;
  name: string;
  eventTitle: string;
  changeType: 'changed' | 'postponed' | 'cancelled';
  summary: string;
  newStartsAt?: Date | string;
  newVenueName?: string;
  detailsUrl: string;
}): SendEmailOptions {
  const typeLabel =
    params.changeType === 'cancelled'
      ? 'CANCELLED'
      : params.changeType === 'postponed'
      ? 'POSTPONED'
      : 'UPDATED';

  const contentHtml = `
    <h2 style="color: #1e293b; margin-top: 0;">Important: Event ${typeLabel}</h2>
    <p>Hello ${params.name || 'there'},</p>
    <p>We are writing to inform you of an important update regarding <strong>${params.eventTitle}</strong>:</p>
    <div style="background-color: #f8fafc; border-left: 4px solid #4f46e5; padding: 16px; margin: 20px 0;">
      <p style="margin: 0; font-weight: 500;">${params.summary}</p>
      ${params.newStartsAt ? `<p style="margin: 8px 0 0 0;"><strong>New Date:</strong> ${formatIST(params.newStartsAt)}</p>` : ''}
      ${params.newVenueName ? `<p style="margin: 8px 0 0 0;"><strong>New Venue:</strong> ${params.newVenueName}</p>` : ''}
    </div>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${params.detailsUrl}" class="btn">View Updated Event Details</a>
    </div>
  `;

  const contentText = `Hello ${params.name || 'there'},

Important update: Event ${typeLabel} - ${params.eventTitle}

${params.summary}
${params.newStartsAt ? `New Date: ${formatIST(params.newStartsAt)}\n` : ''}${params.newVenueName ? `New Venue: ${params.newVenueName}\n` : ''}
Details: ${params.detailsUrl}`;

  const { html, text } = emailLayout({
    title: `Event ${typeLabel}: ${params.eventTitle}`,
    contentHtml,
    contentText,
  });

  return {
    to: params.to,
    subject: `Event Update: ${params.eventTitle} (${typeLabel})`,
    html,
    text,
  };
}

/**
 * 10. Organizer: Alert
 */
export function buildOrganizerAlertTemplate(params: {
  to: string;
  name: string;
  eventTitle: string;
  alertTitle: string;
  message: string;
  severity: string;
  alertUrl?: string;
}): SendEmailOptions {
  const contentHtml = `
    <h2 style="color: #1e293b; margin-top: 0;">[${params.severity.toUpperCase()}] Alert for ${params.eventTitle}</h2>
    <p>Hello ${params.name || 'there'},</p>
    <p><strong>${params.alertTitle}</strong></p>
    <div style="background-color: #fffbeb; border: 1px solid #fef3c7; padding: 16px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0;">${params.message}</p>
    </div>
    ${params.alertUrl ? `<div style="text-align: center; margin: 20px 0;"><a href="${params.alertUrl}" class="btn">View in Eventora</a></div>` : ''}
  `;

  const contentText = `Hello ${params.name || 'there'},

[${params.severity.toUpperCase()}] Alert for ${params.eventTitle}: ${params.alertTitle}

${params.message}
${params.alertUrl ? `Link: ${params.alertUrl}` : ''}`;

  const { html, text } = emailLayout({
    title: `Alert: ${params.eventTitle}`,
    contentHtml,
    contentText,
  });

  return {
    to: params.to,
    subject: `[Alert: ${params.severity.toUpperCase()}] ${params.eventTitle}`,
    html,
    text,
  };
}

/**
 * 11. Feedback Reminder (Non-transactional, includes unsubscribe link)
 */
export function buildFeedbackReminderTemplate(params: {
  to: string;
  name: string;
  eventTitle: string;
  feedbackUrl: string;
  unsubscribeUrl: string;
}): SendEmailOptions {
  const contentHtml = `
    <h2 style="color: #1e293b; margin-top: 0;">How was ${params.eventTitle}?</h2>
    <p>Hello ${params.name || 'there'},</p>
    <p>Thank you for attending <strong>${params.eventTitle}</strong>! The organizers would love to hear your thoughts to make future events even better.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.feedbackUrl}" class="btn">Leave Feedback</a>
    </div>
  `;

  const contentText = `Hello ${params.name || 'there'},

Thank you for attending ${params.eventTitle}! Please take a minute to leave feedback:

Feedback link: ${params.feedbackUrl}`;

  const { html, text } = emailLayout({
    title: `Feedback: ${params.eventTitle}`,
    contentHtml,
    contentText,
    unsubscribeUrl: params.unsubscribeUrl,
  });

  return {
    to: params.to,
    subject: `How was ${params.eventTitle}? Share your feedback`,
    html,
    text,
  };
}
