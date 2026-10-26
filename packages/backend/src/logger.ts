import pino from 'pino';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'password',
  '*.password',
  'body.password',
  'token',
  '*.token',
  'body.token',
  'qr',
  '*.qr',
  'body.qr',
  'secret',
  '*.secret',
  'body.secret',
  'cookie',
  '*.cookie',
  'authorization',
  '*.authorization',
  'email',
  '*.email',
  'body.email',
  'answers',
  '*.answers',
  'body.answers',
  'registrationAnswers',
  '*.registrationAnswers',
  'body.registrationAnswers',
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

export function createLogger(env = process.env.NODE_ENV) {
  return pino({
    level: env === 'test' ? 'silent' : 'info',
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    formatters: {
      log(object: any) {
        if (object.email) {
          object.email = maskEmail(object.email);
        }
        return object;
      },
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.ip,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export const logger = createLogger();
