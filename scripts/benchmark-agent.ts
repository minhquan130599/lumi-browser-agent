/**
 * Real-Chrome benchmark with localhost-only mock Jev provider.
 * Uses an isolated temporary browser profile and no real API credentials.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const dist = path.resolve('dist');
const server = http.createServer(async (req, res) => {
  if (req.url === '/page') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><head><title>Lumi Bench</title></head><body><h1>Lumi Bench</h1><p id="result">Pending</p><button id="run" onclick="document.querySelector(\'#result\').textContent=\'Complete\'">Run sample</button></body></html>');
  } else if (req.url === '/decision' && req.method === 'POST') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    const done = (payload.state?.page?.text || '').includes('Complete');
    const targetId = Object.keys(payload.questions?.click_target?.criteria || {})[0] || '1';
    const answers = done
      ? { operation: { choice: 'DONE', confidence: 0.98, probabilities: { DONE: 0.98, CLICK: 0.02 } }, goal_done: { type: 'noul', noul: 0.98 }, stuck: { type: 'noul', noul: 0.02 } }
      : { operation: { choice: 'CLICK', confidence: 0.98, probabilities: { CLICK: 0.98, DONE: 0.02 } }, click_target: { choice: targetId, confidence: 1, probabilities: { [targetId]: 1 } }, goal_done: { type: 'noul', noul: 0.02 }, stuck: { type: 'noul', noul: 0.02 } };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: 'mock', answers }));
  } else { res.writeHead(404); res.end('Not found'); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Bad port');
const port = address.port;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-latency-'));
const executablePath = process.env.CHROMIUM_PATH || chromium.executablePath();
if (!fs.existsSync(executablePath)) {
  server.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  throw new Error('Playwright Chromium is not installed. Run: npx playwright install chromium, or set CHROMIUM_PATH to a Chromium-for-testing executable.');
}
try {
  const context = await chromium.launchPersistentContext(tempDir, {
    executablePath,
    headless: true,
    args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist, '--no-sandbox', '--silent-debugger-extension-api'],
  });
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
    const extId = new URL(sw.url()).host;
    const ext = await context.newPage();
    await ext.goto('chrome-extension://' + extId + '/options.html');
    for (const delay of [300, 75, 0]) {
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:' + port + '/page');
      const tabId = await sw.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url)?.id, page.url());
      if (tabId === undefined) throw new Error('Could not resolve tab id');
      await ext.evaluate(async settings => chrome.storage.local.set({ jev_settings: settings }), {
        activeProvider: 'typesafe',
        typesafe: { endpoint: 'http://127.0.0.1:' + port + '/decision', model: 'mock', apiKey: '[REDACTED_SECRET]' },
        maxSteps: 5,
        stepDelayMs: delay,
        showOverlay: false,
        trustedInput: false,
      });
      const t0 = Date.now();
      await ext.evaluate(async tabId => chrome.runtime.sendMessage({ type: 'START_AGENT', goal: 'Click Run sample', tabId }), tabId);
      let info: any;
      for (let i = 0; i < 100; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        info = await ext.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'GET_PROGRESS' }))?.progress);
        if (info?.status !== 'running') break;
      }
      console.log(JSON.stringify({ delay, elapsedMs: Date.now() - t0, status: info?.status, steps: info?.currentStep, timing: info?.timing, result: await page.locator('#result').innerText(), error: info?.lastError }));
      await page.close();
    }
  } finally { await context.close(); }
} finally {
  server.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
