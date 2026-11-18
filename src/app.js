import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { ANSWERS, MAX_QUESTION_LENGTH } from '../public/wheel.js';
import { requestLogger, writeLog } from './logging.js';

export function createApp({ chooseIndex = randomInt, log = writeLog } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestLogger(log));
  app.use(express.json({ limit: '4kb' }));

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.post('/api/spin', (request, response) => {
    const question = request.body?.question;
    if (
      typeof question !== 'string'
      || question.trim().length === 0
      || question.trim().length > MAX_QUESTION_LENGTH
    ) {
      return response.status(400).json({
        error: `Enter a question between 1 and ${MAX_QUESTION_LENGTH} characters.`,
      });
    }

    const index = chooseIndex(ANSWERS.length);
    response.set('Cache-Control', 'no-store');
    return response.json({ index, answer: ANSWERS[index] });
  });

  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));

  app.use((error, _request, response, _next) => {
    if (response.headersSent) {
      return response.destroy();
    }
    if (error.type === 'entity.parse.failed') {
      return response.status(400).json({ error: 'Send a valid JSON question.' });
    }
    if (error.type === 'entity.too.large') {
      return response.status(413).json({ error: 'The question is too large.' });
    }
    return response.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
