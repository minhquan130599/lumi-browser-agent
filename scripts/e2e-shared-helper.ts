/**
 * Real Chromium smoke test of shared Chat AI / Text Helper configuration and
 * the background->Side Panel Chrome Built-in AI bridge. No real API keys.
 *
 * CHROMIUM_PATH=/path/to/chromium npx tsx scripts/e2e-shared-helper.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dist = path.resolve('dist');
if (!fs.existsSync(path.join(dist, 'manifest.json'))) throw new Error('Run npm run build first');
const browserPath = process.env.CHROMIUM_PATH || chromium.executablePath();
if (!fs.existsSync(browserPath)) throw new Error('Install Playwright Chromium or set CHROMIUM_PATH.');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-shared-helper-'));
try {
  const browser = await chromium.launchPersistentContext(directory, {
    executablePath: browserPath, headless: true,
    args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist,
      '--no-sandbox', '--silent-debugger-extension-api'],
  });
  try {
    let [worker] = browser.serviceWorkers();
    if (!worker) worker = await browser.waitForEvent('serviceworker', { timeout: 20000 });
    const id = new URL(worker.url()).host;
    const panel = await browser.newPage();
    await panel.goto('chrome-extension://' + id + '/sidepanel.html');
    await panel.locator('.identity').waitFor();
    // Stub the browser Prompt API in this isolated test (not production code).
    await panel.evaluate(`Object.defineProperty(globalThis, 'LanguageModel', {
      configurable: true, writable: true, value: {
        availability: async () => 'available',
        create: async () => ({
          prompt: async () => '{"text":"Da Nang"}',
          destroy: () => undefined
        })
      }
    })`);

    await panel.getByTitle('Cài đặt').click();
    const share = panel.getByRole('radio', { name: /Dùng chung Chat AI/ });
    const advanced = panel.getByRole('radio', { name: /Model riêng/ });
    await share.waitFor();
    if (!(await share.isChecked())) throw new Error('Text Helper should default to Chat AI.');

    const fieldContext = {
      goal: 'Search for Da Nang',
      field: { label: 'Destination' },
      page: { title: 'Flights', text: 'Choose a destination' },
      recent_actions: [],
    };
    const result = await worker.evaluate(async context =>
      chrome.runtime.sendMessage({ type: 'LUMI_CHROME_TEXT_HELPER', context }), fieldContext);
    if (!result?.success || result.text !== '{"text":"Da Nang"}') {
      throw new Error('Chrome AI Side Panel bridge failed: ' + JSON.stringify(result));
    }
    await advanced.click();
    await panel.waitForTimeout(200);
    const afterAdvanced = await worker.evaluate(async () =>
      (await chrome.storage.local.get('jev_settings')).jev_settings?.textHelperMode);
    if (afterAdvanced !== 'custom') throw new Error('Advanced mode not saved.');
    await share.click();
    await panel.waitForTimeout(200);
    const afterShare = await worker.evaluate(async () =>
      (await chrome.storage.local.get('jev_settings')).jev_settings?.textHelperMode);
    if (afterShare !== 'shared') throw new Error('Shared mode not saved.');

    await panel.locator('.config select').selectOption('ollama');
    await panel.locator('.config input').nth(0).fill('qwen3:8b');
    await panel.locator('.config input').nth(1).fill('http://192.168.142.82:11434/v1');
    const saved = await worker.evaluate(async () =>
      (await chrome.storage.local.get(['lumi_ai'])).lumi_ai);
    if (saved.kind !== 'ollama' || saved.model !== 'qwen3:8b' ||
        saved.baseUrl !== 'http://192.168.142.82:11434/v1') {
      throw new Error('Shared provider config did not persist.');
    }
    console.log(JSON.stringify({
      result: 'PASS', chromeBridge: result.success,
      advancedMode: afterAdvanced, sharedMode: afterShare,
      chatProvider: saved.kind, chatModel: saved.model,
    }));
  } finally {
    await browser.close();
  }
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
