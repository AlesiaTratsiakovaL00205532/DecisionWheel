import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';

describe('answer endpoint', () => {
  for (const [index, answer] of [
    [0, 'Yes'],
    [1, 'No'],
    [2, 'Maybe'],
    [3, 'Later'],
  ]) {
    it(`returns sector ${index} and its matching answer`, async () => {
      const chooseIndex = mock.fn(() => index);
      const response = await request(createApp({ chooseIndex }))
        .post('/api/spin')
        .send({ question: 'Should I take a break?' })
        .expect(200);
      assert.deepEqual(response.body, { index, answer });
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.deepEqual(chooseIndex.mock.calls.map((call) => call.arguments), [[4]]);
    });
  }

  for (const body of [{}, { question: '' }, { question: '   ' }, { question: 42 }, { question: 'x'.repeat(241) }]) {
    it(`rejects invalid questions: ${JSON.stringify(body)}`, async () => {
      const chooseIndex = mock.fn();
      await request(createApp({ chooseIndex })).post('/api/spin').send(body).expect(400);
      assert.equal(chooseIndex.mock.callCount(), 0);
    });
  }

  it('accepts a question at the length limit', async () => {
    await request(createApp()).post('/api/spin').send({ question: 'x'.repeat(240) }).expect(200);
  });

  it('rejects malformed JSON without leaking server details', async () => {
    const response = await request(createApp())
      .post('/api/spin')
      .set('Content-Type', 'application/json')
      .send('{"question":')
      .expect(400);
    assert.deepEqual(response.body, { error: 'Send a valid JSON question.' });
  });

  it('serves the page and a health endpoint', async () => {
    const app = createApp();
    await request(app).get('/').expect(200).expect('Content-Type', /html/);
    const response = await request(app).get('/health').expect(200);
    assert.deepEqual(response.body, { status: 'ok' });
  });
});
