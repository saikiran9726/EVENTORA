import http from 'http';
import crypto from 'crypto';
import { AddressInfo } from 'net';

export interface FakeOrderRecord {
  id: string;
  orderId: string;
  amount: string;
  amountPaise: number;
  currency: string;
  returnUrl?: string;
  status: 'PENDING' | 'QUEUED' | 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  utr?: string;
  slotActive: boolean;
  queueStatus: 'ACTIVE' | 'WAITING' | 'FULL';
  expiresAt: string;
  createdAt: string;
  completedAt?: string;
}

export class FakeYouPiServer {
  private server: http.Server | null = null;
  public port: number = 0;
  public baseUrl: string = '';
  public webhookSecret: string = 'youpi_test_webhook_secret_key_2026';
  public merchantId: string = '00000000-0000-0000-0000-000000000001';

  // Queue and orders state
  public orders: Map<string, FakeOrderRecord> = new Map();
  public activeSlotOrderId: string | null = null;
  public queue: string[] = [];

  // Behavior overrides for edge case testing
  public forceAmountMismatch: boolean = false;
  public forceStatusResponse: string | null = null;

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as AddressInfo;
        this.port = addr.port;
        this.baseUrl = `http://127.0.0.1:${this.port}`;
        resolve(this.baseUrl);
      });

      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  reset(): void {
    this.orders.clear();
    this.activeSlotOrderId = null;
    this.queue = [];
    this.forceAmountMismatch = false;
    this.forceStatusResponse = null;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);
    const method = req.method?.toUpperCase();

    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');

      // 1. POST /api/v1/payments (Create Payment Session)
      if (method === 'POST' && url.pathname === '/api/v1/payments') {
        try {
          const body = JSON.parse(rawBody || '{}');
          const { orderId, amount, currency = 'INR', returnUrl } = body;

          if (!orderId || !amount) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(
              JSON.stringify({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'orderId and amount are required',
                },
              })
            );
          }

          const amountPaise = Math.round(parseFloat(amount) * 100);

          // Check if orderId already exists
          const existing = this.orders.get(orderId);
          if (existing) {
            if (existing.amountPaise !== amountPaise || this.forceAmountMismatch) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              return res.end(
                JSON.stringify({
                  error: {
                    code: 'ORDER_AMOUNT_MISMATCH',
                    message: `Order ${orderId} already exists with a different amount (${existing.amount} vs ${amount})`,
                  },
                })
              );
            }
            // Idempotent return of existing order
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(
              JSON.stringify({
                id: existing.id,
                orderId: existing.orderId,
                amount: existing.amount,
                amountPaise: existing.amountPaise,
                currency: existing.currency,
                status: existing.status,
                checkoutUrl: `http://127.0.0.1:7000/pay/${existing.id}`,
                queueStatus: existing.queueStatus,
                slotActive: existing.slotActive,
                expiresAt: existing.expiresAt,
              })
            );
          }

          // Single-slot FIFO queue check
          let slotActive = false;
          let queueStatus: 'ACTIVE' | 'WAITING' | 'FULL' = 'ACTIVE';

          if (!this.activeSlotOrderId) {
            this.activeSlotOrderId = orderId;
            slotActive = true;
            queueStatus = 'ACTIVE';
          } else {
            this.queue.push(orderId);
            slotActive = false;
            queueStatus = 'WAITING';
          }

          const paymentId = `youpi_pay_${crypto.randomUUID()}`;
          const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

          const record: FakeOrderRecord = {
            id: paymentId,
            orderId,
            amount: parseFloat(amount).toFixed(2),
            amountPaise,
            currency,
            returnUrl,
            status: slotActive ? 'PENDING' : 'QUEUED',
            slotActive,
            queueStatus,
            expiresAt,
            createdAt: new Date().toISOString(),
          };

          this.orders.set(orderId, record);
          this.orders.set(paymentId, record); // allow lookup by either id

          res.writeHead(201, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              id: paymentId,
              orderId,
              amount: record.amount,
              amountPaise,
              currency,
              status: record.status,
              checkoutUrl: `http://127.0.0.1:7000/pay/${paymentId}`,
              queueStatus,
              slotActive,
              expiresAt,
            })
          );
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              error: { code: 'INTERNAL_ERROR', message: err.message },
            })
          );
        }
      }

      // 2. GET /api/v1/payments/:id (Get Status)
      const getMatch = url.pathname.match(/^\/api\/v1\/payments\/([^/]+)$/);
      if (method === 'GET' && getMatch) {
        const id = getMatch[1];
        const record = this.orders.get(id);

        if (!record) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              error: { code: 'ORDER_NOT_FOUND', message: `Payment session ${id} not found` },
            })
          );
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            id: record.id,
            orderId: record.orderId,
            amount: record.amount,
            amountPaise: record.amountPaise,
            currency: record.currency,
            status: this.forceStatusResponse || record.status,
            utr: record.utr || null,
            slotActive: record.slotActive,
            queueStatus: record.queueStatus,
            completedAt: record.completedAt || null,
          })
        );
      }

      // 3. GET /youpi.js (One-script checkout client)
      if (method === 'GET' && (url.pathname === '/youpi.js' || url.pathname === '/checkout.js')) {
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(`
          (function() {
            window.Youpi = {
              pay: function(opts) {
                console.log('[FakeYouPi] pay invoked for order:', opts.order_id);
                if (typeof opts.handler === 'function') {
                  setTimeout(function() {
                    opts.handler({
                      order_id: opts.order_id,
                      payment_id: 'fake_pay_' + opts.order_id,
                      status: 'SUCCESS'
                    });
                  }, 50);
                }
              }
            };
          })();
        `);
      }

      // 4. GET /pay/:id (Hosted checkout portal mock)
      if (method === 'GET' && url.pathname.startsWith('/pay/')) {
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>YouPI-PG Hosted Checkout</title></head>
            <body>
              <div id="youpi-portal">
                <h2>YouPI-PG UPI QR Portal</h2>
                <p>Simulated hosted payment session</p>
              </div>
            </body>
          </html>
        `);
      }

      // Fallback 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));
    });
  }

  /**
   * Simulates a verified payment success and returns the signed webhook headers & body.
   */
  generateWebhookPayload(
    orderId: string,
    opts?: {
      deliveryId?: string;
      timestamp?: number;
      utr?: string;
      event?: string;
      amountPaise?: number;
      secret?: string;
      omitV2?: boolean;
    }
  ): { headers: Record<string, string>; rawBody: Buffer; payload: any } {
    const record = this.orders.get(orderId);
    if (!record) {
      throw new Error(`Order ${orderId} not found in fake server`);
    }

    const deliveryId = opts?.deliveryId || crypto.randomUUID();
    const timestamp = opts?.timestamp !== undefined ? opts.timestamp : Date.now();
    const utr = opts?.utr || `${Math.floor(100000000000 + Math.random() * 900000000000)}`;
    const event = opts?.event || 'SUCCESS';
    const amountPaise = opts?.amountPaise !== undefined ? opts.amountPaise : record.amountPaise;
    const amount = (amountPaise / 100).toFixed(2);

    record.status = event === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
    record.utr = utr;
    record.completedAt = new Date().toISOString();

    const payloadObj = {
      event,
      orderId,
      amount,
      amountPaise,
      utr,
      paymentId: record.id,
      deliveryId,
      timestamp,
    };

    const rawBody = Buffer.from(JSON.stringify(payloadObj), 'utf8');
    const secret = opts?.secret || this.webhookSecret;

    // V2 signature: HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
    const v2Digest = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');
    const signatureV2 = `sha256=${v2Digest}`;

    // V1 signature: HMAC-SHA256(secret, rawBody)
    const v1Digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const signatureV1 = `sha256=${v1Digest}`;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-gateway-event': event,
      'x-gateway-delivery-id': deliveryId,
      'x-gateway-timestamp': timestamp.toString(),
      'x-gateway-signature': signatureV1,
      'X-Gateway-Event': event,
      'X-Gateway-Delivery-Id': deliveryId,
      'X-Gateway-Timestamp': timestamp.toString(),
      'X-Gateway-Signature': signatureV1,
    };

    if (!opts?.omitV2) {
      headers['x-gateway-signature-v2'] = signatureV2;
      headers['X-Gateway-Signature-V2'] = signatureV2;
    }

    return {
      headers,
      rawBody,
      payload: payloadObj,
    };
  }

  /**
   * Releases current active slot and activates the next in queue.
   */
  advanceQueue(): string | null {
    if (this.queue.length > 0) {
      const nextOrderId = this.queue.shift()!;
      this.activeSlotOrderId = nextOrderId;
      const rec = this.orders.get(nextOrderId);
      if (rec) {
        rec.slotActive = true;
        rec.queueStatus = 'ACTIVE';
        rec.status = 'PENDING';
      }
      return nextOrderId;
    }
    this.activeSlotOrderId = null;
    return null;
  }
}
