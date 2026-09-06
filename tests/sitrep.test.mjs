import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('SITREP consumes the frozen skill-lib projection instead of redefining repo authority', async () => {
  const source = await readFile('scripts/fetch-sitrep.mjs', 'utf8');
  assert.match(source, /repository-plan-report\.schema\.json/);
  assert.match(source, /9b347b2dff7692054b571602f30ee6d00c2e7265/);
  assert.match(source, /interdependent-work-graph\/portfolio_plan\.py/);
  assert.match(source, /97b8b546b4151486164c8a4b730c24a8c895b25b/);
  assert.match(source, /runPortfolio/);
  assert.match(source, /python3/);
  assert.match(source, /missingReports/);
});

test('SITREP current portfolio explicitly covers the evidence-bounded core graph', async () => {
  const source = await readFile('scripts/fetch-sitrep.mjs', 'utf8');
  for (const repository of [
    'skill-lib',
    'metapat',
    'ucns',
    'edcm',
    'pcea',
    'ptcna',
    'epac',
    'zfae',
    'a0',
    'stack',
    'The-Interdependency.github.io'
  ]) {
    assert.match(source, new RegExp(repository.replaceAll('.', '\\.')));
  }
  assert.match(source, /Explicit portfolio membership/);
  assert.doesNotMatch(source, /org-wide auto-discovery/i);
});

test('SITREP failure publication classifies errors instead of echoing command details', async () => {
  const source = await readFile('scripts/fetch-sitrep.mjs', 'utf8');
  assert.match(source, /function publicFailureReason/);
  assert.match(source, /fallbackData\(publicFailureReason\(error\)\)/);
  assert.doesNotMatch(source, /fallbackData\(error\.message/);
  assert.doesNotMatch(source, /reason:\s*error\.message/);
});

test('report-only coordination commits do not make a self-report stale by construction', async () => {
  const source = await readFile('scripts/fetch-sitrep.mjs', 'utf8');
  assert.match(source, /reportOnlyRefresh/);
  assert.match(source, /parents/);
  assert.match(source, /changedFiles/);
  assert.match(source, /telemetry\.changedFiles\[0\] === localReportPath/);
  assert.match(source, /sourceCommit === head \|\| reportOnlyRefresh \? 'current' : 'HEAD differs'/);
  assert.doesNotMatch(source, /sourceCommit === head \? 'current' : 'stale'/);
});

test('SITREP presentation keeps declared situation separate from observed GitHub telemetry', async () => {
  const template = await readFile('src/sitrep/index.njk', 'utf8');
  assert.match(template, /Declared · repo-owned/);
  assert.match(template, /Observed · GitHub/);
  assert.match(template, /Report\/head mismatch is shown rather than silently reconciled/);
  assert.match(template, /authority transfer: false/);
});

test('SITREP formatting exposes scan, map, actionable summaries, and evidence without hiding hmmm', async () => {
  const [template, interaction] = await Promise.all([
    readFile('src/sitrep/index.njk', 'utf8'),
    readFile('src/assets/js/sitrep.js', 'utf8')
  ]);
  assert.match(template, /aria-label="Repository situation index"/);
  assert.match(template, /Portfolio scan/);
  assert.match(template, /Repository dependency map/);
  assert.match(template, /data-sitrep-map-viewport/);
  assert.match(template, /data-sitrep-map-edge/);
  assert.match(template, /data-sitrep-section="frontier"/);
  assert.match(template, /aria-controls="{{ project\.slug }}-frontier"/);
  assert.match(template, /Current claim/);
  assert.match(template, /Open full report/);
  assert.match(template, /Show exact source identities/);
  assert.match(template, /Honest incompletion stays visible and countable/);
  assert.match(interaction, /renderDependencyMap/);
  assert.match(interaction, /activateMetricDisclosures/);
  assert.doesNotMatch(template, /sitrep-orbit/);
});

test('website participates through the skill-lib repository-plan-report contract', async () => {
  const report = JSON.parse(await readFile('docs/work-graphs/repository-plan-report.json', 'utf8'));
  assert.equal(report.schema, 'the-interdependency.repository-plan-report');
  assert.equal(report.version, '1.0.0');
  assert.equal(report.repository, 'The-Interdependency/The-Interdependency.github.io');
  assert.equal(report.contract.repository, 'The-Interdependency/skill-lib');
  assert.equal(report.contract.path, 'interdependent-work-graph/repository-plan-report.schema.json');
  assert.equal(report.contract.blob_sha, '9b347b2dff7692054b571602f30ee6d00c2e7265');
  assert.equal(report.portfolio_role.reports_to.skill, 'interdependent-work-graph');
  assert.match(report.source.commit, /^[0-9a-f]{40}$/);
  assert.ok(report.authority.non_transfer.length > 0);
});
