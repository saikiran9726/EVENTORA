import crypto from 'crypto';

export interface CreateOrderParams {
  orderId: string;
  amountPaise: number;
  currency?: string;
  receipt?: string;
  returnUrl?: string;
  notes?: Record<string, string>;
}

export interface CreateOrderResult {
  orderId: string;
  providerPaymentId: string;
  amountPaise: number;
  currency: string;
  checkoutUrl?: string;
  queueStatus?: 'ACTIVE' | 'WAITING' | 'FULL';
  slotActive: boolean;
  expiresAt?: string;
}

export interface VerifyPaymentParams {
  orderId: string;
  paymentId: string;
  signature?: string;
}

export interface PaymentStatusResult {
  id: string;
  orderId: string;
  status: 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | 'PENDING' | 'QUEUED';
  amountPaise: number;
  utr?: string;
  slotActive?: boolean;
  queueStatus?: 'ACTIVE' | 'WAITING' | 'FULL';
  completedAt?: string;
}

export interface WebhookVerificationParams {
  rawBody: Buffer;
  signatureV2?: string;
  signatureV1?: string;
  timestamp?: string;
  deliveryId?: string;
  secret?: string;
}

export interface RefundParams {
  paymentId: string;
  amountPaise: number;
  reason?: string;
}

export interface PaymentAdapter {
  name: string;
  createOrder(params: CreateOrderParams): Promise<CreateOrderResult>;
  getStatus(providerPaymentIdOrOrderId: string): Promise<PaymentStatusResult>;
  verifyWebhook(params: WebhookVerificationParams): { valid: boolean; reason?: string };
  createRefund(params: RefundParams): Promise<{ success: boolean; refundId?: string; manualRequired?: boolean; message?: string }>;
}

export class PaymentAdapterError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, any>;

  constructor(code: string, message: string, statusCode = 400, details?: Record<string, any>) {
    super(message);
    this.name = 'PaymentAdapterError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * YouPI-PG Gateway Adapter (Self-hosted direct UPI gateway).
 * Communicates with YouPI-PG Payment API (:6100) and handles signed V2 webhooks.
 */
export class YouPiPaymentAdapter implements PaymentAdapter {
  public name = 'youpi';
  private apiUrl: string;
  private merchantId: string;
  private webhookSecret: string;

  constructor(config?: { apiUrl?: string; merchantId?: string; webhookSecret?: string }) {
    this.apiUrl = config?.apiUrl || process.env.YOUPI_API_BASE_URL || process.env.YOUPI_API_URL || 'http://127.0.0.1:6100';
    this.merchantId = config?.merchantId || process.env.YOUPI_MERCHANT_ID || '00000000-0000-0000-0000-000000000001';
    this.webhookSecret = config?.webhookSecret || process.env.YOUPI_WEBHOOK_SECRET || 'youpi_webhook_secret_key_2026';
  }

  setApiUrl(url: string): void {
    this.apiUrl = url;
  }

  setWebhookSecret(secret: string): void {
    this.webhookSecret = secret;
  }

  setMerchantId(id: string): void {
    this.merchantId = id;
  }

  /**
   * Initializes a new payment session with YouPI-PG.
   * Dispatches POST /api/v1/payments with X-Merchant-Id and Idempotency-Key.
   */
  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    const { orderId, amountPaise, currency = 'INR', returnUrl } = params;
    const amountInRupees = (amountPaise / 100).toFixed(2);

    const payload = {
      orderId,
      amount: amountInRupees,
      currency,
      returnUrl: returnUrl || `https://eventora.campus.edu/checkout/callback?orderId=${encodeURIComponent(orderId)}`,
    };

    try {
      const response = await fetch(`${this.apiUrl}/api/v1/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Merchant-Id': this.merchantId,
          'Idempotency-Key': orderId,
        },
        body: JSON.stringify(payload),
      });

      const responseBody = await response.json().catch(() => ({}));

      if (response.status === 409 && (responseBody?.error?.code === 'ORDER_AMOUNT_MISMATCH' || responseBody?.code === 'ORDER_AMOUNT_MISMATCH')) {
        throw new PaymentAdapterError(
          'ORDER_AMOUNT_MISMATCH',
          responseBody?.error?.message || responseBody?.message || `Order amount mismatch for order ${orderId}`,
          409,
          responseBody?.error?.details || responseBody
        );
      }

      if (!response.ok) {
        throw new PaymentAdapterError(
          responseBody?.error?.code || 'GATEWAY_ERROR',
          responseBody?.error?.message || `YouPI returned status ${response.status}`,
          response.status >= 500 ? 502 : 400,
          responseBody
        );
      }

      return {
        orderId: responseBody.orderId || orderId,
        providerPaymentId: responseBody.id || `youpi_${orderId}`,
        amountPaise,
        currency,
        checkoutUrl: responseBody.checkoutUrl,
        queueStatus: responseBody.queueStatus || (responseBody.slotActive ? 'ACTIVE' : 'WAITING'),
        slotActive: Boolean(responseBody.slotActive ?? true),
        expiresAt: responseBody.expiresAt,
      };
    } catch (err: any) {
      if (err instanceof PaymentAdapterError) {
        throw err;
      }
      throw new PaymentAdapterError(
        'GATEWAY_UNREACHABLE',
        `Failed to reach YouPI gateway at ${this.apiUrl}: ${err.message}`,
        503,
        { originalError: err.message }
      );
    }
  }

  /**
   * Queries YouPI-PG status API: GET /api/v1/payments/:id
   */
  async getStatus(providerPaymentIdOrOrderId: string): Promise<PaymentStatusResult> {
    try {
      const response = await fetch(`${this.apiUrl}/api/v1/payments/${encodeURIComponent(providerPaymentIdOrOrderId)}`, {
        method: 'GET',
        headers: {
          'X-Merchant-Id': this.merchantId,
        },
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new PaymentAdapterError(
          body?.error?.code || 'STATUS_QUERY_FAILED',
          body?.error?.message || `Failed to fetch payment status: ${response.status}`,
          response.status === 404 ? 404 : 400,
          body
        );
      }

      const rawAmount = body.amountPaise !== undefined
        ? body.amountPaise
        : Math.round(parseFloat(body.amount || '0') * 100);

      return {
        id: body.id,
        orderId: body.orderId,
        status: body.status,
        amountPaise: rawAmount,
        utr: body.utr || undefined,
        slotActive: body.slotActive,
        queueStatus: body.queueStatus,
        completedAt: body.completedAt,
      };
    } catch (err: any) {
      if (err instanceof PaymentAdapterError) throw err;
      throw new PaymentAdapterError(
        'GATEWAY_UNREACHABLE',
        `Failed to query YouPI payment status: ${err.message}`,
        503
      );
    }
  }

  /**
   * Verifies HMAC-SHA256 signature on incoming webhook.
   * Priority:
   * 1. X-Gateway-Signature-V2: HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
   * 2. X-Gateway-Signature: HMAC-SHA256(secret, rawBody) fallback if V2 is absent
   * Enforces 2-hour timestamp freshness window to cover YouPI retry schedule.
   */
  verifyWebhook(params: WebhookVerificationParams): { valid: boolean; reason?: string } {
    const { rawBody, signatureV2, signatureV1, timestamp } = params;
    const secret = params.secret || this.webhookSecret;

    if (!rawBody || rawBody.length === 0) {
      return { valid: false, reason: 'Empty raw body' };
    }

    // 1. Freshness check: timestamp must be within 2 hours
    if (timestamp) {
      const tsNum = Number(timestamp);
      if (isNaN(tsNum)) {
        return { valid: false, reason: 'Invalid timestamp header' };
      }
      const ageMs = Math.abs(Date.now() - tsNum);
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      if (ageMs > TWO_HOURS_MS) {
        return {
          valid: false,
          reason: `Timestamp outside 2-hour retry window (delta: ${Math.round(ageMs / 1000)}s)`,
        };
      }
    }

    // 2. V2 Signature verification (Timestamp bound)
    if (signatureV2) {
      if (!timestamp) {
        return { valid: false, reason: 'Signature V2 requires X-Gateway-Timestamp header' };
      }

      const rawString = rawBody.toString('utf8');
      const signedData = `${timestamp}.${rawString}`;
      const expectedDigest = crypto.createHmac('sha256', secret).update(signedData).digest('hex');
      const expectedSig = `sha256=${expectedDigest}`;

      const expectedBuf = Buffer.from(expectedSig, 'utf8');
      const providedBuf = Buffer.from(signatureV2, 'utf8');

      if (expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf)) {
        return { valid: true };
      }
      return { valid: false, reason: 'Signature V2 mismatch' };
    }

    // 3. V1 Signature fallback (Only if V2 is absent)
    if (signatureV1) {
      const expectedDigest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const expectedSig = `sha256=${expectedDigest}`;

      const expectedBuf = Buffer.from(expectedSig, 'utf8');
      const providedBuf = Buffer.from(signatureV1, 'utf8');

      if (expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf)) {
        return { valid: true };
      }
      return { valid: false, reason: 'Signature V1 mismatch' };
    }

    return { valid: false, reason: 'No signature header present' };
  }

  /**
   * YouPI collects directly into bank accounts via direct UPI, so no direct refund API exists.
   * Model refunds as REFUND_PENDING_MANUAL.
   */
  async createRefund(_params: RefundParams) {
    return {
      success: false,
      manualRequired: true,
      message: 'YouPI peer-to-peer settlements require manual bank transfer with recorded UTR.',
    };
  }
}

/**
 * Simulator Payment Adapter for controlled tests & non-production mock environments.
 */
export class SimulatorPaymentAdapter implements PaymentAdapter {
  public name = 'simulator';
  public webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || 'simulator_webhook_secret_key_2026';
  public forcePaymentStatus: 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'AUTO' = 'AUTO';
  public orders = new Map<string, { amountPaise: number; currency: string; status: string }>();
  public payments = new Map<string, { orderId: string; amountPaise: number; status: string }>();

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    const orderId = params.orderId || `sim_ord_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.orders.set(orderId, {
      amountPaise: params.amountPaise,
      currency: params.currency || 'INR',
      status: 'CREATED',
    });
    return {
      orderId,
      providerPaymentId: `sim_pay_${orderId}`,
      amountPaise: params.amountPaise,
      currency: params.currency || 'INR',
      checkoutUrl: `http://127.0.0.1:7000/pay/${orderId}`,
      queueStatus: 'ACTIVE',
      slotActive: true,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
  }

  async getStatus(providerPaymentIdOrOrderId: string): Promise<PaymentStatusResult> {
    const order = this.orders.get(providerPaymentIdOrOrderId);
    const amountPaise = order?.amountPaise || 10000;
    return {
      id: providerPaymentIdOrOrderId,
      orderId: providerPaymentIdOrOrderId,
      status: this.forcePaymentStatus === 'FAILED' ? 'FAILED' : 'SUCCESS',
      amountPaise,
      utr: '987654321012',
      slotActive: true,
      queueStatus: 'ACTIVE',
      completedAt: new Date().toISOString(),
    };
  }

  async verifyPayment(params: { orderId: string; paymentId: string; signature?: string }) {
    const order = this.orders.get(params.orderId);
    const amountPaise = order?.amountPaise || 10000;

    if (this.forcePaymentStatus === 'FAILED' || params.paymentId.includes('fail')) {
      return {
        success: false,
        orderId: params.orderId,
        paymentId: params.paymentId,
        amountPaise,
        failureCode: 'SIMULATED_DECLINE',
      };
    }

    if (this.forcePaymentStatus === 'PENDING') {
      return {
        success: false,
        orderId: params.orderId,
        paymentId: params.paymentId,
        amountPaise,
        failureCode: 'SIMULATED_PENDING',
      };
    }

    this.payments.set(params.paymentId, {
      orderId: params.orderId,
      amountPaise,
      status: 'SUCCEEDED',
    });

    return {
      success: true,
      orderId: params.orderId,
      paymentId: params.paymentId,
      amountPaise,
    };
  }

  generateWebhookSignature(rawBody: Buffer, secret = this.webhookSecret): string {
    return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  }

  verifyWebhook(params: WebhookVerificationParams): { valid: boolean; reason?: string } {
    const { rawBody, signatureV2, signatureV1, timestamp } = params;
    const secret = params.secret || this.webhookSecret;

    if (!rawBody || rawBody.length === 0) return { valid: false, reason: 'Empty raw body' };

    if (signatureV2 && timestamp) {
      const signedData = `${timestamp}.${rawBody.toString('utf8')}`;
      const expectedDigest = crypto.createHmac('sha256', secret).update(signedData).digest('hex');
      const expectedSig = `sha256=${expectedDigest}`;
      const expectedBuf = Buffer.from(expectedSig, 'utf8');
      const providedBuf = Buffer.from(signatureV2, 'utf8');
      if (expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf)) {
        return { valid: true };
      }
    }

    if (signatureV1) {
      const rawSig = signatureV1.startsWith('sha256=') ? signatureV1.slice(7) : signatureV1;
      const expectedDigest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const expectedBuf = Buffer.from(expectedDigest, 'utf8');
      const providedBuf = Buffer.from(rawSig, 'utf8');
      if (expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf)) {
        return { valid: true };
      }
    }

    return { valid: false, reason: 'Invalid signature' };
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string, secret = this.webhookSecret): boolean {
    if (!signature || !rawBody) return false;
    const expected = this.generateWebhookSignature(rawBody, secret);
    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(signature, 'utf8');
    return expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);
  }

  async createRefund(params: RefundParams) {
    return {
      success: true,
      refundId: `sim_rfnd_${Date.now()}_${params.paymentId.slice(0, 8)}`,
    };
  }
}

export const simulatorAdapter = new SimulatorPaymentAdapter();
export const youpiAdapter = new YouPiPaymentAdapter();

export function getPaymentAdapter(override?: string): PaymentAdapter {
  const provider = override || process.env.PAYMENT_PROVIDER || process.env.PAYMENT_ADAPTER || 'simulator';
  if (provider === 'youpi') {
    return youpiAdapter;
  }
  return simulatorAdapter;
}
