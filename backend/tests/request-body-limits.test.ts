import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import express from 'express';
import { applyRequestBodyLimits, LARGE_BODY_PATHS } from '../src/requestBodyLimits';

const app = express();
applyRequestBodyLimits(app);

for (const route of LARGE_BODY_PATHS) {
  app.post(route, (req, res) => {
    res.json({ length: req.body.payload.length });
  });
}
app.post('/api/auth/login', (_req, res) => res.json({ ok: true }));
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(error.status || 500).end();
});

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});

test('5 MB JSON is rejected on login but accepted on every designated upload route', async () => {
  const payload = 'x'.repeat(5 * 1024 * 1024);
  const body = JSON.stringify({ payload });

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  assert.equal(loginResponse.status, 413);

  for (const route of LARGE_BODY_PATHS) {
    const response = await fetch(`${baseUrl}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    assert.equal(response.status, 200, `${route} should accept a scan/bulk payload`);
    assert.deepEqual(await response.json(), { length: payload.length });
  }
});

test('URL-encoded requests use the 1 MB default limit', async () => {
  const body = `payload=${'x'.repeat(2 * 1024 * 1024)}`;
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  assert.equal(response.status, 413);
});
