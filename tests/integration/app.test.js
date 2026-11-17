import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';

describe('answer endpoint', () => {
  it.each([
    [0, 'Yes'],
    [1, 'No'],
    [2, 'Maybe'],
    [3, 'Later'],
  ])('returns sector %i and its matching answer', async (index, answer) => {
    const chooseIndex = vi.fn(() => index);
    const response = await request(createApp({ chooseIndex }))
      .post('/api/spin')
      .send({ question: 'Should I take a break?' })
      .expect(200);
    expect(response.body).toEqual({ index, answer });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(chooseIndex).toHaveBeenCalledWith(4);
  });

  it.each([{}, { question: '' }, { question: '   ' }, { question: 42 }, { question: 'x'.repeat(241) }])(
    'rejects invalid questions: %j',
    async (body) => {
      const chooseIndex = vi.fn();
      await request(createApp({ chooseIndex })).post('/api/spin').send(body).expect(400);
      expect(chooseIndex).not.toHaveBeenCalled();
    },
  );

  it('accepts a question at the length limit', async () => {
    await request(createApp()).post('/api/spin').send({ question: 'x'.repeat(240) }).expect(200);
  });

  it('rejects malformed JSON without leaking server details', async () => {
    const response = await request(createApp())
      .post('/api/spin')
      .set('Content-Type', 'application/json')
      .send('{"question":')
      .expect(400);
    expect(response.body).toEqual({ error: 'Send a valid JSON question.' });
  });

  it('serves the page and a health endpoint', async () => {
    const app = createApp();
    await request(app).get('/').expect(200).expect('Content-Type', /html/);
    const response = await request(app).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
