import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it, mock } from 'node:test';
import { fileURLToPath } from 'node:url';
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

describe('privacy-preserving application logs', () => {
  const privateValue = 'private-person-question-password-secret-canary';
  const createLoggedApp = (options = {}) => {
    const entries = [];
    const app = createApp({ ...options, log: (entry) => entries.push(entry) });
    return { app, entries };
  };
  const assertPrivate = (entries) => {
    const serialized = JSON.stringify(entries);
    assert.ok(!serialized.includes(privateValue));
    assert.ok(!serialized.includes('"Yes"'));
    assert.ok(!serialized.includes('"Maybe"'));
  };

  it('records request metadata without logging bodies, answers, queries or headers', async () => {
    const { app, entries } = createLoggedApp({ chooseIndex: () => 0 });
    const response = await request(app)
      .post(`/api/spin?email=${privateValue}`)
      .set('Authorization', `Bearer ${privateValue}`)
      .set('Cookie', `session=${privateValue}`)
      .set('X-Request-ID', privateValue)
      .set('X-Forwarded-For', privateValue)
      .set('User-Agent', privateValue)
      .send({ question: privateValue, password: privateValue, name: privateValue })
      .expect(200);
    assert.equal(response.body.answer, 'Yes');
    assert.equal(entries.length, 1);
    const [entry] = entries;
    assert.deepEqual(Object.keys(entry).sort(), [
      'duration_ms', 'event', 'level', 'method', 'outcome',
      'request_id', 'route', 'status', 'timestamp',
    ]);
    assert.equal(entry.event, 'http_request');
    assert.equal(entry.level, 'info');
    assert.equal(entry.method, 'POST');
    assert.equal(entry.route, '/api/spin');
    assert.equal(entry.status, 200);
    assert.equal(entry.outcome, 'completed');
    assert.equal(entry.request_id, response.headers['x-request-id']);
    assert.match(entry.request_id, /^[0-9a-f-]{36}$/);
    assert.ok(Number.isFinite(Date.parse(entry.timestamp)));
    assert.ok(entry.duration_ms >= 0);
    assertPrivate(entries);
  });

  for (const scenario of [
    { name: 'unknown paths', status: 404, code: 'not_found', route: 'other' },
    { name: 'malformed JSON', status: 400, code: 'bad_request', route: '/api/spin' },
    { name: 'oversized bodies', status: 413, code: 'payload_too_large', route: '/api/spin' },
    { name: 'unexpected errors', status: 500, code: 'internal_error', route: '/api/spin' },
  ]) {
    it(`logs ${scenario.name} without exposing input or exception details`, async () => {
      const { app, entries } = createLoggedApp({
        chooseIndex: () => { throw new Error(privateValue); },
      });
      if (scenario.status === 404) {
        await request(app).get(`/missing-${privateValue}?token=${privateValue}`).expect(404);
      } else {
        const call = request(app).post('/api/spin');
        if (scenario.status === 400) {
          call.set('Content-Type', 'application/json').send(`{"question":"${privateValue}`);
        } else {
          call.send({
            question: privateValue,
            extra: scenario.status === 413 ? privateValue.repeat(200) : privateValue,
          });
        }
        await call.expect(scenario.status);
      }
      assert.equal(entries.length, 1);
      assert.equal(entries[0].status, scenario.status);
      assert.equal(entries[0].route, scenario.route);
      assert.equal(entries[0].level, scenario.status === 500 ? 'error' : 'warn');
      assert.equal(entries[0].error_code, scenario.code);
      assertPrivate(entries);
    });
  }

  it('logs health and static requests with distinct server-generated request IDs', async () => {
    const { app, entries } = createLoggedApp();
    await request(app).get(`/health?question=${privateValue}`).expect(200);
    await request(app).get(`/?question=${privateValue}`).expect(200);
    assert.deepEqual(entries.map((entry) => entry.route), ['/health', 'other']);
    assert.notEqual(entries[0].request_id, entries[1].request_id);
    assertPrivate(entries);
  });

  it('records an interrupted response once without reporting a completed HTTP status', { timeout: 5000 }, async () => {
    const entries = [];
    const recorded = Promise.withResolvers();
    const app = createApp({
      log: (entry) => {
        entries.push(entry);
        recorded.resolve();
      },
    });
    app.get('/interrupted', (_request, response) => {
      response.write(privateValue);
      response.destroy();
    });
    await assert.rejects(async () => request(app).get('/interrupted'));
    await recorded.promise;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].outcome, 'aborted');
    assert.equal(entries[0].status, null);
    assert.equal(entries[0].error_code, 'request_aborted');
    assertPrivate(entries);
  });

  it('reports a startup failure without a raw exception or environment details', () => {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../../src/server.js', import.meta.url)),
    ], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: '65536' },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 1, result.stderr || String(result.error));
    assert.equal(result.stderr, '');
    const entry = JSON.parse(result.stdout.trim());
    assert.equal(entry.event, 'server_error');
    assert.equal(entry.error_code, 'listen_failed');
    assert.deepEqual(Object.keys(entry).sort(), ['error_code', 'event', 'level', 'timestamp']);
  });
});
