import { randomUUID } from 'node:crypto';

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

export function writeLog(entry) {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

export function requestLogger(log = writeLog) {
  return (request, response, next) => {
    const started = process.hrtime.bigint();
    const requestId = randomUUID();
    const method = METHODS.has(request.method) ? request.method : 'OTHER';
    const route = ['/api/spin', '/health', '/metrics'].includes(request.path) ? request.path : 'other';
    let logged = false;
    response.set('X-Request-ID', requestId);

    const record = (completed) => {
      if (logged) return;
      logged = true;
      const status = completed ? response.statusCode : null;
      let level = 'info';
      let errorCode;
      if (!completed) {
        level = 'warn';
        errorCode = 'request_aborted';
      } else if (status >= 500) {
        level = 'error';
        errorCode = 'internal_error';
      } else if (status >= 400) {
        level = 'warn';
        errorCode = ({
          400: 'bad_request',
          404: 'not_found',
          413: 'payload_too_large',
        })[status] || 'request_rejected';
      }
      log({
        timestamp: new Date().toISOString(),
        level,
        event: 'http_request',
        request_id: requestId,
        method,
        route,
        status,
        duration_ms: Number((Number(process.hrtime.bigint() - started) / 1e6).toFixed(3)),
        outcome: completed ? 'completed' : 'aborted',
        ...(errorCode ? { error_code: errorCode } : {}),
      });
    };
    response.once('finish', () => record(true));
    response.once('close', () => record(false));
    next();
  };
}
