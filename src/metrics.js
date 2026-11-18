import { Counter, Histogram, Registry } from 'prom-client';

export function createMetrics() {
  const registry = new Registry();
  const labelNames = ['method', 'route', 'status'];
  const requests = new Counter({
    name: 'decision_wheel_http_requests_total',
    help: 'Completed or interrupted application requests, excluding metric scrapes.',
    labelNames,
    registers: [registry],
  });
  const errors = new Counter({
    name: 'decision_wheel_http_errors_total',
    help: 'HTTP 4xx/5xx responses and interrupted requests.',
    labelNames,
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'decision_wheel_http_request_duration_seconds',
    help: 'Application request duration in seconds, including error responses.',
    labelNames,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  return {
    registry,
    observe(entry) {
      if (entry.route === '/metrics') return;
      const labels = {
        method: entry.method,
        route: entry.route,
        status: entry.status === null ? 'aborted' : String(entry.status),
      };
      requests.inc(labels);
      if (entry.status === null || entry.status >= 400) errors.inc(labels);
      duration.observe(labels, entry.duration_ms / 1000);
    },
  };
}
