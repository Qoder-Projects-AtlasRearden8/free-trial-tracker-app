import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

function startTestServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const started = new Promise((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => {
      reject(new Error(`Server did not start in time. ${stderr}`));
    }, 5000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = stdout.match(/running at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early with code ${code}. ${stderr}`));
    });
  });

  return { child, started };
}

test('local server serves the app with scoped security headers', async () => {
  const { child, started } = startTestServer();
  const exit = once(child, 'exit');

  try {
    const baseUrl = await started;

    const home = await fetch(`${baseUrl}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /^text\/html/);
    assert.match(home.headers.get('content-security-policy'), /connect-src 'none'/);
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    assert.match(await home.text(), /<title>Trialwise/);

    const serviceWorker = await fetch(`${baseUrl}/sw.js`);
    assert.equal(serviceWorker.status, 200);
    const swCsp = serviceWorker.headers.get('content-security-policy');
    assert.match(swCsp, /connect-src 'self'/);
    assert.doesNotMatch(swCsp, /connect-src 'none'/);
    assert.match(await serviceWorker.text(), /trialwise-shell/);

    const icon = await fetch(`${baseUrl}/icons/icon.svg`);
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get('content-type'), /^image\/svg\+xml/);

    const head = await fetch(`${baseUrl}/app.js`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');

    const missing = await fetch(`${baseUrl}/missing-page`);
    assert.equal(missing.status, 404);

    const traversal = await fetch(`${baseUrl}/..%2Fpackage.json`);
    assert.equal(traversal.status, 404);

    const rejectedMethod = await fetch(`${baseUrl}/`, { method: 'POST' });
    assert.equal(rejectedMethod.status, 405);
    assert.equal(rejectedMethod.headers.get('allow'), 'GET, HEAD');
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      exit,
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }
});
