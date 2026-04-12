import fs from 'node:fs';
import path from 'node:path';

const [resultsPathArg, casesPathArg, thresholdArg] = process.argv.slice(2);
const resultsPath = resultsPathArg || 'tests/ui/artifacts/playwright-report/results.json';
const casesPath = casesPathArg || 'tests/ui/coverage/cases.json';
const threshold = Number(thresholdArg || process.env.UI_COVERAGE_THRESHOLD || 90);

const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
const requiredCaseIds = Array.isArray(cases.requiredCaseIds) ? cases.requiredCaseIds : null;

if (!requiredCaseIds || requiredCaseIds.length === 0) {
  console.error('[ui-coverage] FAILED: requiredCaseIds is missing or empty in coverage cases config');
  process.exit(1);
}

const covered = new Set();

const walkSuites = (suite) => {
  for (const spec of suite.specs || []) {
    const title = String(spec.title || '');
    const match = title.match(/\[(UI-\d+)\]/);
    if (!match) continue;
    const testWasExecuted = (spec.tests || []).some(test =>
      (test.results || []).some(result => ['passed', 'failed'].includes(result.status))
    );
    if (testWasExecuted) covered.add(match[1]);
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

const summaryPath = path.resolve('tests/ui/artifacts/ui-coverage-summary.json');
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log(`[ui-coverage] ${coveredCount}/${total} => ${coverage}% (threshold: ${threshold}%)`);
if (!summary.passed) {
  console.error(`[ui-coverage] FAILED: coverage below threshold; uncovered: ${summary.uncoveredCases.join(', ')}`);
  process.exit(1);
}
