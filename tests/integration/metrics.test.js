import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';

const quiet = { log: () => {} };

describe('privacy-preserving Prometheus metrics', () => {
  it('counts completed requests and observes latency without counting scrapes', async () => {
    const app = createApp({ ...quiet, chooseIndex: () => 0 });
    await request(app).get('/health').expect(200);
    await request(app).post('/api/spin').send({ question: 'synthetic question' }).expect(200);
    const first = await request(app).get('/metrics').expect(200)
      .expect('Content-Type', /text\/plain/)
      .expect('Cache-Control', 'no-store');
    assert.match(first.text, /decision_wheel_http_requests_total\{method="GET",route="\/health",status="200"\} 1/);
    assert.match(first.text, /decision_wheel_http_requests_total\{method="POST",route="\/api\/spin",status="200"\} 1/);
    assert.match(first.text, /decision_wheel_http_request_duration_seconds_count\{method="POST",route="\/api\/spin",status="200"\} 1/);
    assert.match(first.text, /decision_wheel_http_request_duration_seconds_bucket\{le="\+Inf",method="GET",route="\/health",status="200"\} 1/);
    const second = await request(app).get('/metrics').expect(200);
    assert.equal(first.text, second.text);
  });

  it('counts client/server errors using bounded labels without exposing input or exceptions', async () => {
    const privateValue = 'private-question-password-person-canary';
    const app = createApp({
      ...quiet,
      chooseIndex: () => { throw new Error(privateValue); },
    });
    await request(app).post('/api/spin').send({}).expect(400);
    await request(app).post(`/api/spin?secret=${privateValue}`)
      .set('Cookie', `session=${privateValue}`)
      .set('X-Request-ID', privateValue)
      .send({ question: privateValue }).expect(500);
    await request(app).get(`/missing-${privateValue}`).expect(404);
    const { text } = await request(app).get('/metrics').expect(200);
    for (const [route, status, method] of [['/api/spin', 400, 'POST'], ['/api/spin', 500, 'POST'], ['other', 404, 'GET']]) {
      assert.ok(text.includes(`decision_wheel_http_errors_total{method="${method}",route="${route}",status="${status}"} 1`));
    }
    assert.ok(!text.includes(privateValue));
    assert.doesNotMatch(text, /question=|password=|request_id=|ip=|"(?:Yes|No|Maybe|Later)"/);
  });

  it('counts an interrupted response exactly once and labels its status as aborted', { timeout: 5000 }, async () => {
    const recorded = Promise.withResolvers();
    const app = createApp({ log: () => recorded.resolve() });
    app.get('/interrupted', (_request, response) => {
      response.write('synthetic response');
      response.destroy();
    });
    await assert.rejects(async () => request(app).get('/interrupted'));
    await recorded.promise;
    const { text } = await request(app).get('/metrics').expect(200);
    assert.match(text, /decision_wheel_http_errors_total\{method="GET",route="other",status="aborted"\} 1/);
    assert.match(text, /decision_wheel_http_requests_total\{method="GET",route="other",status="aborted"\} 1/);
  });

  it('keeps registries isolated between application instances', async () => {
    const first = createApp(quiet);
    const second = createApp(quiet);
    await request(first).get('/health').expect(200);
    const { text } = await request(second).get('/metrics').expect(200);
    assert.doesNotMatch(text, /decision_wheel_http_requests_total\{/);
    assert.doesNotMatch(text, /decision_wheel_http_request_duration_seconds_count\{/);
  });
});
