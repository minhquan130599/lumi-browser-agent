/**
 * Isolated browser smoke test for explicit YouTube navigation and playback.
 * Fake content is served via Playwright routing; it never hits the real YouTube.
 * A local mock Jev intentionally returns BLOCKED to exercise safe recovery.
 *
 * Run: npm run build
 *      CHROMIUM_PATH=/path/to/chromium npx tsx scripts/e2e-youtube.ts
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dist = path.resolve('dist');
if (!fs.existsSync(path.join(dist, 'manifest.json'))) throw new Error('Run npm run build first');
const server = http.createServer(async (req, res) => {
  if (req.url === '/initial') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>Unrelated web page</title><main>Ollama help article</main>');
    return;
  }
  if (req.url === '/v1/systemone' && req.method === 'POST') {
    const buffers: Buffer[] = [];
    for await (const chunk of req) buffers.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(buffers).toString());
    const ops = Object.keys(payload.questions?.operation?.criteria || {});
    const probabilities = Object.fromEntries(ops.map(op => [op, op === 'BLOCKED' ? 0.81 : 0.19 / (ops.length - 1)]));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      model: 'mock-blocked',
      answers: {
        operation: { type: 'choice', choice: 'BLOCKED', confidence: 0.81, probabilities },
        stuck: { type: 'noul', noul: 0.80 },
        goal_done: { type: 'noul', noul: 0.10 },
      },
    }));
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS' });
    res.end();
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No server port');
const port = address.port;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-youtube-smoke-'));
const executable = process.env.CHROMIUM_PATH || chromium.executablePath();
try {
  if (!fs.existsSync(executable)) throw new Error('Install Playwright Chromium or set CHROMIUM_PATH');
  const context = await chromium.launchPersistentContext(directory, {
    executablePath: executable,
    headless: true,
    args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist, '--no-sandbox',
      '--disable-gpu', '--silent-debugger-extension-api'],
  });
  try {
    await context.route('https://www.youtube.com/**', async route => {
      const url = route.request().url();
      if (new URL(url).pathname === '/results') {
        const rap = (new URL(url).searchParams.get('search_query') || '').toLowerCase().includes('rap');
        await route.fulfill({
          status: 200, contentType: 'text/html; charset=utf-8',
          body: '<!doctype html><html><head><title>YouTube search results</title></head><body>' +
            (rap
              ? '<main><h1>Search results for rap Đen Vâu</h1>' +
                '<a href="/watch?v=other123">Nhạc Thiếu Nhi Vui Nhộn</a>' +
                '<a href="/watch?v=denvau123">Đen Vâu Rap Việt Nam - Official Music Video</a></main>'
              : '<main><h1>Search results for nhạc thiếu nhi</h1>' +
                '<a href="/watch?v=kids123">Nhạc Thiếu Nhi Vui Nhộn Cho Bé - music</a></main>') +
            '</body></html>',
        });
      } else if (new URL(url).pathname === '/watch') {
        await route.fulfill({
          status: 200, contentType: 'text/html; charset=utf-8',
          body: '<!doctype html><html><head><title>Nhạc thiếu nhi - YouTube</title></head><body>' +
            '<main><h1>Nhạc Thiếu Nhi Vui Nhộn Cho Bé</h1>' +
            '<button id="subscribe">Subscribe</button><button id="share">Share</button>' +
            '<video id="player" style="width:400px;height:220px" onclick="this.play()"></video>' +
            '<script>const c=document.createElement("canvas");c.width=160;c.height=90;' +
            'const ctx=c.getContext("2d");let n=0;setInterval(()=>{ctx.fillStyle=n++%2?"red":"blue";ctx.fillRect(0,0,160,90)},100);' +
            'const v=document.querySelector("video");v.srcObject=c.captureStream(10);</script></main></body></html>',
        });
      } else {
        await route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>Not found</h1>' });
      }
    });

    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
    const id = new URL(worker.url()).host;
    const extension = await context.newPage();
    await extension.goto('chrome-extension://' + id + '/options.html');
    await extension.evaluate(async (portNumber: number) => {
      await chrome.storage.local.set({ jev_settings: {
        activeProvider: 'typesafe', typesafe: {
          endpoint: 'http://127.0.0.1:' + portNumber + '/v1/systemone',
          model: 'mock-blocked', apiKey: '',
        },
        maxSteps: 10, stepDelayMs: 0, showOverlay: true, trustedInput: true,
      } });
    }, port);

    const page = await context.newPage();
    await page.goto('http://127.0.0.1:' + port + '/initial');
    const tabId = await worker.evaluate(async (url: string) =>
      (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, page.url());
    if (!tabId) throw new Error('Could not resolve page tab');

    const goal = 'mở youtube.com tìm 1 bản nhạc thiếu nhi và bật cho tôi';
    const startup = await extension.evaluate(async ({ tabId, goal }) =>
      chrome.runtime.sendMessage({ type: 'START_AGENT', tabId, goal }), { tabId, goal });
    if (!startup?.success) throw new Error('Agent did not start: ' + JSON.stringify(startup));
    const start = Date.now();
    let progress: any;
    let observedBadges = 0;
    for (let i = 0; i < 120; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      progress = await extension.evaluate(async () =>
        (await chrome.runtime.sendMessage({ type: 'GET_PROGRESS' }))?.progress);
      observedBadges = Math.max(observedBadges, await page.locator('.__jev_badge').count());
      if (progress && !['running', 'paused'].includes(progress.status)) break;
    }
    // The finish() cleanup message is asynchronous; wait for it before
    // inspecting whether the completed run left numbered badges behind.
    await page.locator('.__jev_badge').first().waitFor({ state: 'detached', timeout: 2500 });
    console.log(JSON.stringify({
      status: progress?.status,
      steps: progress?.currentStep,
      tookMs: Date.now() - start,
      url: page.url(),
      playing: page.url().includes('/watch') ? await page.evaluate(() => !document.querySelector('video')?.paused) : null,
      operations: (progress?.logs || []).map((l: any) => l.operation).reverse(),
      peakBadges: observedBadges,
      remainingBadges: await page.locator('.__jev_badge').count(),
      error: progress?.lastError,
    }));
    if (progress?.status !== 'done' ||
        !page.url().startsWith('https://www.youtube.com/watch?v=kids123') ||
        !(await page.evaluate(() => !document.querySelector('video')?.paused)) ||
        (await page.locator('.__jev_badge').count()) !== 0) {
      throw new Error('YouTube navigation/search/playback smoke test failed');
    }

    // Regression for the actual user phrasing: the starting tab is unrelated,
    // no ".com" and no "tìm" appear in the goal. The mocked results include
    // an unrelated first video and a matching Đen Vâu rap link.
    await page.goto('http://127.0.0.1:' + port + '/initial');
    const rapGoal = 'mở youtube, bật cho tôi 1 bài rap của đen vâu';
    const rapStart = await extension.evaluate(async ({ tabId, goal }) =>
      chrome.runtime.sendMessage({ type: 'START_AGENT', tabId, goal }),
    { tabId, goal: rapGoal });
    if (!rapStart?.success) throw new Error('Natural-language goal did not start: ' + JSON.stringify(rapStart));
    let rapProgress: any;
    for (let i = 0; i < 120; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      rapProgress = await extension.evaluate(async () =>
        (await chrome.runtime.sendMessage({ type: 'GET_PROGRESS' }))?.progress);
      if (rapProgress && !['running', 'paused'].includes(rapProgress.status)) break;
    }
    const rapResult = {
      status: rapProgress?.status,
      step: rapProgress?.currentStep,
      url: page.url(),
      playing: await page.evaluate(() => !document.querySelector('video')?.paused),
      operations: (rapProgress?.logs || []).map((l: any) => l.operation).reverse(),
      jevDecisionCalls: rapProgress?.timing?.decisionCalls,
    };
    console.log(JSON.stringify({ naturalLanguageRapTest: rapResult }));
    if (rapResult.status !== 'done' ||
        rapResult.step < 3 ||
        !rapResult.url.startsWith('https://www.youtube.com/watch?v=denvau123') ||
        !rapResult.playing ||
        !rapResult.operations.includes('SEARCH (navigate)') ||
        !rapResult.operations.includes('CLICK (YouTube recovery)')) {
      throw new Error('Natural-language YouTube rap music workflow failed');
    }

    // Badge overlay regression: render numbered controls, disable overlay via
    // the same message as Side Panel and verify it clears immediately AND
    // remains disabled for subsequent observations (no reload required).
    const observation = await extension.evaluate(async target =>
      chrome.tabs.sendMessage(target, { type: 'CONTENT_OBSERVE' }), tabId);
    if (!observation?.success) throw new Error('Could not render badge test controls');
    const before = await page.locator('.__jev_badge').count();
    const toggle = await extension.evaluate(async target =>
      chrome.runtime.sendMessage({ type: 'TOGGLE_OVERLAY', show: false, tabId: target }), tabId);
    const after = await page.locator('.__jev_badge').count();
    await extension.evaluate(async target =>
      chrome.tabs.sendMessage(target, { type: 'CONTENT_OBSERVE' }), tabId);
    const afterRepeat = await page.locator('.__jev_badge').count();
    const persisted = await extension.evaluate(async () =>
      (await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })).settings.showOverlay);
    console.log(JSON.stringify({ badgeOverlayTest: {
      before, after, afterRepeat, persisted, toggleSuccess: toggle?.success,
    } }));
    if (before < 1 || after !== 0 || afterRepeat !== 0 || persisted !== false || !toggle?.success) {
      throw new Error('Jev badge overlay toggle smoke test failed');
    }
  } finally { await context.close(); }
} finally {
  server.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
