import { createApp } from './app.js';
import { writeLog } from './logging.js';

const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';

function logListenError() {
  writeLog({
    timestamp: new Date().toISOString(),
    level: 'error',
    event: 'server_error',
    error_code: 'listen_failed',
  });
  process.exitCode = 1;
}

try {
  const server = createApp().listen(port, host, () => {
    writeLog({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'server_started',
      port: server.address().port,
    });
  });
  server.on('error', logListenError);
} catch {
  logListenError();
}
