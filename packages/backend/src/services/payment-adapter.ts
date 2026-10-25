import crypto from 'crypto';

export interface CreateOrderParams {
  amountPaise: number;
  currency?: string;
  receipt?: string;
  notes?: Record<string, string>;
}

export interface VerifyPaymentParams {
  orderId: string;
  paymentId: string;
  signature?: string;
}

export interface RefundParams {
  paymentId: string;
  amountPaise: number;
  reason?: string;
}

export interface PaymentAdapter {
  name: string;
  createOrder(params: CreateOrderParams): Promise<{ orderId: string; amountPaise: number; currency: string }>;
  verifyPayment(params: VerifyPaymentParams): Promise<{
    success: boolean;
    orderId: string;
    paymentId: string;
    amountPaise: number;
    failureCode?: string;
  }>;
  verifyWebhookSignature(rawBody: Buffer, signature: string, secret?: string): boolean;
  createRefund(params: RefundParams): Promise<{ success: boolean; refundId: string }>;
}

/**
 * In-memory / Deterministic Simulator Adapter (Default test mode).
 */
export class SimulatorPaymentAdapter implements PaymentAdapter {
  public name = 'simulator';
  public webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || 'simulator_webhook_secret_key_2026';

  // State controls for dev / test simulation console
  public forcePaymentStatus: 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'AUTO' = 'AUTO';
  public orders = new Map<string, { amountPaise: number; currency: string; status: string }>();
  public payments = new Map<string, { orderId: string; amountPaise: number; status: string }>();

  async createOrder(params: CreateOrderParams) {
    const orderId = `sim_ord_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.orders.set(orderId, {
      amountPaise: params.amountPaise,
      currency: params.currency || 'INR',
      status: 'CREATED',
    });
    return {
      orderId,
      amountPaise: params.amountPaise,
      currency: params.currency || 'INR',
    };
  }

  async verifyPayment(params: VerifyPaymentParams) {
    const order = this.orders.get(params.orderId);
    if (!order) {
      return {
        success: false,
        orderId: params.orderId,
        paymentId: params.paymentId,
        amountPaise: 0,
        failureCode: 'ORDER_NOT_FOUND',
      };
    }
    const amountPaise = order.amountPaise;

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

    // Default: Succeeded
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

  /**
   * Constant-time timing-safe HMAC-SHA256 signature verification over raw request bytes.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string, secret = this.webhookSecret): boolean {
    if (!signature || !rawBody) return false;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const providedBuf = Buffer.from(signature, 'utf8');

    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  }

  generateWebhookSignature(rawBody: Buffer, secret = this.webhookSecret): string {
    return crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
  }

  async createRefund(params: RefundParams) {
    const refundId = `sim_rfnd_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    return {
      success: true,
      refundId,
    };
  }
}

export const simulatorAdapter = new SimulatorPaymentAdapter();

export function getPaymentAdapter(): PaymentAdapter {
  const adapterType = process.env.PAYMENT_ADAPTER || 'simulator';
  if (adapterType === 'simulator') {
    return simulatorAdapter;
  }
  // Sandbox adapter can be extended here
  return simulatorAdapter;
}
