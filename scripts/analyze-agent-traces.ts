/**
 * P3 opt-in empirical trace analyzer. Reads files exported by Lumi's
 * "Sao chép chẩn đoán" command and produces ONLY aggregate metrics.
 * Does not print goals, URLs, user data, or model prompts.
 *
 * npm run benchmark:traces -- --input docs/benchmarks/example-traces.json
 */
import fs from 'node:fs';
import path from 'node:path';

interface Trace {
  status?: string;
  step?: number;
  currentStep?: number;
  timing?: { totalMs?: number; decisionMs?: number; decisionCalls?: number };
  decisions?: Array<{ operation?: string }>;
  verification?: { ok?: boolean };
  replans?: number;
}
const arg = process.argv.indexOf('--input');
if (arg < 0 || !process.argv[arg + 1]) {
  throw new Error('Usage: npm run benchmark:traces -- --input path/to/exported-traces.json');
}
const json = JSON.parse(fs.readFileSync(path.resolve(process.argv[arg + 1]), 'utf8'));
const records: Trace[] = Array.isArray(json) ? json : Array.isArray(json.traces) ? json.traces : [json];
if (!records.length) throw new Error('Empty trace dataset.');
const numbers = (values: number[]) => values.filter(v => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
const percentile = (values: number[], q: number): number | null =>
  values.length ? values[Math.min(values.length - 1, Math.floor(q * (values.length - 1)))] : null;
const latencies = numbers(records.map(r => Number(r.timing?.totalMs)));
const decisionTimes = numbers(records.map(r => Number(r.timing?.decisionMs)));
const total = records.length;
const done = records.filter(r => r.status === 'done');
const verifiedDone = done.filter(r => r.verification?.ok === true);
const unverifiedDone = done.filter(r => r.verification?.ok !== true);
const stepZeroDone = done.filter(r => (r.step ?? r.currentStep ?? -1) === 0);
const results = {
  kind: 'empirical-user-exported-traces',
  total,
  statusCounts: {
    done: done.length,
    blocked: records.filter(r => r.status === 'blocked').length,
    error: records.filter(r => r.status === 'error').length,
    other: records.filter(r => !['done', 'blocked', 'error'].includes(r.status || '')).length
  },
  verifiedDone: verifiedDone.length,
  unverifiedDone: unverifiedDone.length,
  stepZeroDone: stepZeroDone.length,
  verifiedCompletionRate: Number((verifiedDone.length / total).toFixed(4)),
  verificationCoverageAmongDone: Number((done.filter(r => typeof r.verification?.ok === 'boolean').length / Math.max(done.length, 1)).toFixed(4)),
  latencyMs: { p50: percentile(latencies, .5), p95: percentile(latencies, .95) },
  decisionLatencyMs: { p50: percentile(decisionTimes, .5), p95: percentile(decisionTimes, .95) },
  totalJevCalls: records.reduce((sum, r) => sum + (r.timing?.decisionCalls || 0), 0),
  totalReplans: records.reduce((sum, r) => sum + (r.replans || 0), 0),
  limitations: [
    'Verified DONE is evidence of implemented checks, not independently confirmed user satisfaction.',
    'Unverified DONE cannot automatically be classified as false DONE.',
    'Latency and completion depend on your actual provider, device, network and websites.',
  ],
};
console.log(JSON.stringify(results, null, 2));
const output = process.argv.indexOf('--output');
if (output >= 0 && process.argv[output + 1]) {
  const filename = path.resolve(process.argv[output + 1]);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(results, null, 2) + '\n');
}
