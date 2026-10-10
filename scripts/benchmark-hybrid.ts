/**
 * Reproducible P3 regression benchmark. This is an OFFLINE fixture benchmark,
 * NOT a cloud-model accuracy test. No browser data, credentials or network.
 *
 * npm run benchmark:agent
 * npm run benchmark:agent -- --output docs/benchmarks/local-result.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { routeDirectIntent, verifyMediaCommand } from '../src/shared/intent-router';
import { verifyGenericDone } from '../src/shared/completion-verifier';
import { parseNavigationIntent } from '../src/shared/navigation-intent';
import { titleMatchesRequestedSong } from '../src/shared/youtube-support';

type TestCase = {
  id: string;
  type: string;
  goal?: string;
  url?: string;
  query?: string;
  expected: string | boolean;
  before?: string;
  after?: string;
  playing?: boolean;
  actual?: string;
  requested?: string;
  text?: string;
  history?: Array<{ kind: 'click'; page_changed: boolean }>;
};
const file = path.resolve('scripts/hybrid-benchmark-fixtures.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { cases: TestCase[] };
const rows: Array<{ id: string; type: string; pass: boolean; elapsedMs: number; actual: string | boolean }> = [];
const isPositive = (v: string | boolean) => v === true || (typeof v === 'string' && v !== 'none');
for (const c of data.cases) {
  const start = performance.now();
  let actual: string | boolean;
  switch (c.type) {
    case 'intent':
      actual = routeDirectIntent(c.goal || '', c.url || '')?.command
        ? 'media.' + routeDirectIntent(c.goal || '', c.url || '')!.command : 'none';
      break;
    case 'navigation': {
      const parsed = parseNavigationIntent(c.goal || '');
      actual = parsed?.hostname || 'none';
      if (parsed && c.query) actual = parsed.searchQuery === c.query ? actual : 'wrong-query';
      break;
    }
    case 'media_verification':
      actual = verifyMediaCommand(
        { kind: 'media', command: 'next', verification: 'video_changed_and_playing' },
        { videoId: c.before || '', playing: true, found: true },
        { videoId: c.after || '', playing: Boolean(c.playing), found: true }
      ).ok;
      break;
    case 'done_verification':
      actual = verifyGenericDone(c.goal || 'click button',
        { url: 'https://example.com/', title: 'Test', text: c.text || 'Success' },
        (c.history || []).map(x => ({ action: 'CLICK Test', kind: x.kind, page_changed: x.page_changed }))
      ).verified;
      break;
    case 'title':
      actual = titleMatchesRequestedSong(c.actual || '', c.requested || '');
      break;
    default: throw new Error('Unknown benchmark fixture type ' + c.type);
  }
  rows.push({ id: c.id, type: c.type, pass: actual === c.expected,
    elapsedMs: Number((performance.now() - start).toFixed(5)), actual });
}
const sorted = rows.map(r => r.elapsedMs).sort((a, b) => a - b);
const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
const falseDones = rows.filter((row, i) =>
  data.cases[i].expected === false && row.actual === true &&
  ['media_verification', 'done_verification'].includes(row.type));
const passed = rows.filter(r => r.pass).length;
const summary = {
  benchmark: 'lumi-hybrid-offline',
  kind: 'deterministic-fixtures-only',
  tests: rows.length,
  passed,
  failed: rows.length - passed,
  accuracy: Number((passed / rows.length).toFixed(4)),
  falseDoneCount: falseDones.length,
  latencyMs: { p50: p(.5), p95: p(.95) },
  failures: rows.filter(r => !r.pass).map(r => ({ id: r.id, actual: r.actual })),
};
console.log(JSON.stringify(summary, null, 2));
const arg = process.argv.indexOf('--output');
if (arg !== -1 && process.argv[arg + 1]) {
  const dest = path.resolve(process.argv[arg + 1]);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify({ ...summary, rows }, null, 2) + '\n');
}
if (passed !== rows.length || falseDones.length) process.exitCode = 1;
