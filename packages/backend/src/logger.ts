import pino from 'pino';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  // Passwords & secrets
  'password',
  '*.password',
  'body.password',
  'passwordHash',
  '*.passwordHash',
  'secret',
  '*.secret',
  'body.secret',
  // Auth & Session tokens
  'token',
  '*.token',
  'body.token',
  'sessionToken',
  '*.sessionToken',
  'refreshToken',
  '*.refreshToken',
  'csrfToken',
  '*.csrfToken',
  'cookie',
  '*.cookie',
  'authorization',
  '*.authorization',
  // QR codes & hashes
  'qr',
  '*.qr',
  'body.qr',
  'qrTokenHash',
  '*.qrTokenHash',
  'qrData',
  '*.qrData',
  // Banking, UTR & Payment details
  'utr',
  '*.utr',
  'body.utr',
  'youpiUtr',
  '*.youpiUtr',
  'body.youpiUtr',
  'cardNumber',
  '*.cardNumber',
  'cvv',
  '*.cvv',
  'pin',
  '*.pin',
  // Personal Identifiable Information & Answers
  'email',
  '*.email',
  'body.email',
  'phone',
  '*.phone',
  'body.phone',
  'phoneNumber',
  '*.phoneNumber',
  'body.phoneNumber',
  'answers',
  '*.answers',
  'body.answers',
  'registrationAnswers',
  '*.registrationAnswers',
  'body.registrationAnswers',
  'pan',
  '*.pan',
  'aadhaar',
  '*.aadhaar',
];

export function maskEmail(email?: string): string {
  if (!email || typeof email !== 'string') return '';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  const maskedName = name.length > 2 ? `${name[0]}***${name[name.length - 1]}` : '***';
  return `${maskedName}@${domain}`;
}

export function maskPhone(phone?: string): string {
  if (!phone || typeof phone !== 'string') return '';
  const cleaned = phone.trim();
  if (cleaned.length <= 4) return '****';
  const visible = cleaned.slice(-4);
  return `******${visible}`;
}

export function createLogger(env = process.env.NODE_ENV, destination?: any) {
  const options = {
    level: env === 'test' && !destination ? 'silent' : process.env.LOG_LEVEL || 'info',
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    formatters: {
      log(object: any) {
        if (object.email && typeof object.email === 'string') {
          object.email = maskEmail(object.email);
        }
        if (object.phone && typeof object.phone === 'string') {
          object.phone = maskPhone(object.phone);
        }
        if (object.phoneNumber && typeof object.phoneNumber === 'string') {
          object.phoneNumber = maskPhone(object.phoneNumber);
        }
        return object;
      },
    },
    serializers: {
      req(req: any) {
        return {
          id: req.id,
          requestId: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.ip,
        };
      },
      res(res: any) {
        return {
          statusCode: res.statusCode,
        };
      },
      err: pino.stdSerializers.err,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();
