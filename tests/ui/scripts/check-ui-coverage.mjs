import fs from 'node:fs';
import path from 'node:path';

const [resultsPathArg, casesPathArg, thresholdArg] = process.argv.slice(2);
const resultsPath = resultsPathArg || 'tests/ui/artifacts/playwright-report/results.json';
const casesPath = casesPathArg || 'tests/ui/coverage/cases.json';
const threshold = Number(thresholdArg || process.env.UI_COVERAGE_THRESHOLD || 90);

const writeSummary = (summary) => {
  const summaryPath = path.resolve('tests/ui/artifacts/ui-coverage-summary.json');
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
};

const fail = (message, extra = {}) => {
  const summary = {
    totalCases: 0,
    coveredCases: 0,
    uncoveredCases: [],
    coverage: 0,
    threshold: Number.isFinite(threshold) ? threshold : null,
    passed: false,
    error: message,
    ...extra
  };
  writeSummary(summary);
  console.error(`[ui-coverage] FAILED: ${message}`);
  process.exit(1);
};

if (!Number.isFinite(threshold)) {
  fail(`invalid threshold value: ${String(threshold)}; threshold must be a finite number`);
}

let results;
let cases;
try {
  results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
} catch (error) {
  fail(`cannot read or parse results file ${resultsPath}: ${error?.message || 'unknown error'}`);
}
try {
  cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
} catch (error) {
  fail(`cannot read or parse cases file ${casesPath}: ${error?.message || 'unknown error'}`);
}
const requiredCaseIds = cases.requiredCaseIds;

if (!Array.isArray(requiredCaseIds) || requiredCaseIds.length === 0) {
  fail(`requiredCaseIds is missing or empty in ${casesPath}`);
}

const covered = new Set();
const ranStatuses = new Set(['passed', 'failed', 'timedOut', 'interrupted']);

const walkSuites = (suite) => {
  for (const spec of suite.specs || []) {
    const title = String(spec.title || '');
    const match = title.match(/\[(UI-\d+)\]/);
    if (!match) continue;
    const testRan = (spec.tests || []).some(test =>
      (test.results || []).some(result => ranStatuses.has(result.status))
    );
    if (testRan) covered.add(match[1]);
  }
  for (const child of suite.suites || []) walkSuites(child);
};

for (const suite of results.suites || []) walkSuites(suite);

const total = requiredCaseIds.length;
const coveredCount = requiredCaseIds.filter(id => covered.has(id)).length;
const coverage = Number(((coveredCount / total) * 100).toFixed(2));

const summary = {
  totalCases: total,
  coveredCases: coveredCount,
  uncoveredCases: requiredCaseIds.filter(id => !covered.has(id)),
  coverage,
  threshold,
  passed: coverage >= threshold
};

writeSummary(summary);

console.log(`[ui-coverage] ${coveredCount}/${total} => ${coverage}% (threshold: ${threshold}%)`);
if (!summary.passed) {
  console.error(`[ui-coverage] FAILED: coverage below threshold; uncovered: ${summary.uncoveredCases.join(', ')}`);
  process.exit(1);
}
