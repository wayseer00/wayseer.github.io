import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// === MODULE_BUILD ===
// id: repository_sitrep_projection
//   purpose: Build the public repository SITREP from repo-owned plan reports through the exact skill-lib portfolio projection, then add separate GitHub telemetry.
//   entrypoint: npm run refresh:sitrep
//   tests: tests/sitrep.test.mjs
// === END MODULE_BUILD ===
// === BOUNDARIES ===
// id: sitrep_authority_boundary
//   network: reads public GitHub repository metadata and repo-owned reports; optional token raises rate limits
//   storage: writes generated and last-known-good SITREP JSON only
//   authority: skill-lib owns the reporting contract and deterministic projection; each repository owns its report claims; this site owns presentation only
//   failure: never reconstructs missing reports; never publishes raw command errors or credentials; missing or source-different reports remain visible and a last-known-good projection may be used only with fallback=true
// === END BOUNDARIES ===
// Usage: run `npm run refresh:sitrep`; the output is presentation data, not a new source of repository canon.

const org = 'The-Interdependency';
const githubApiOrigin = 'https://api.github.com';
const websiteRepository = `${org}/The-Interdependency.github.io`;
const localReportPath = 'docs/work-graphs/repository-plan-report.json';

// Exact control-plane identity. The report schema is already frozen by blob SHA;
// the portfolio script is additionally pinned so the website cannot silently
// reinterpret repo reports when skill-lib main changes.
const controlPlane = {
  repository: `${org}/skill-lib`,
  commit: 'c14ee9d500579a4b5d6821f62c9d82ca96e73608',
  skill: 'interdependent-work-graph',
  reportSchemaVersion: '1.0.0',
  reportSchemaPath: 'interdependent-work-graph/repository-plan-report.schema.json',
  reportSchemaBlob: '9b347b2dff7692054b571602f30ee6d00c2e7265',
  portfolioScriptPath: 'interdependent-work-graph/portfolio_plan.py',
  portfolioScriptBlob: '97b8b546b4151486164c8a4b730c24a8c895b25b'
};

// Explicit portfolio membership: this is the evidence-bounded core graph, not
// organization-wide repository discovery. Repositories outside this set remain
// outside the current projection until a deliberate membership decision adds them.
const projectDefinitions = [
  { repository: `${org}/skill-lib`, name: 'skill-lib', label: 'Skill Library', slug: 'skill-lib' },
  { repository: `${org}/metapat`, name: 'metapat', label: 'METAPAT', slug: 'metapat' },
  { repository: `${org}/ucns`, name: 'ucns', label: 'UCNS', slug: 'ucns' },
  { repository: `${org}/edcm`, name: 'edcm', label: 'EDCM', slug: 'edcm' },
  { repository: `${org}/pcea`, name: 'pcea', label: 'PCEA', slug: 'pcea' },
  { repository: `${org}/ptcna`, name: 'ptcna', label: 'PTCNA', slug: 'ptcna' },
  { repository: `${org}/epac`, name: 'epac', label: 'EPAC', slug: 'epac' },
  { repository: `${org}/zfae`, name: 'zfae', label: 'ZFAE', slug: 'zfae' },
  { repository: `${org}/a0`, name: 'a0', label: 'a0', slug: 'a0' },
  { repository: `${org}/stack`, name: 'stack', label: 'Stack', slug: 'stack' },
  { repository: websiteRepository, name: 'The-Interdependency.github.io', label: 'Website', slug: 'website', localReport: true }
];

const headers = ['-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28'];
if (process.env.GITHUB_TOKEN) headers.push('-H', `Authorization: Bearer ${process.env.GITHUB_TOKEN}`);

function githubApiUrl(pathname, search = {}) {
  const url = new URL(pathname, githubApiOrigin);
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, String(value));
  return url;
}

function getJson(target) {
  const url = target instanceof URL ? target : new URL(target);
  if (url.protocol !== 'https:' || url.origin !== githubApiOrigin) {
    throw new Error(`refusing non-GitHub API target: ${url.origin}`);
  }
  return JSON.parse(execFileSync(
    'curl',
    ['-fsSL', '--retry', '2', '--max-time', '30', ...headers, url.href],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ));
}

function tryGetJson(target) {
  try { return getJson(target); } catch { return null; }
}

function publicFailureReason(error, scope = 'refresh') {
  const message = String(error?.message || error || '');
  if (message.includes('offline requested')) return 'offline refresh requested';
  if (message.includes('skill-lib report schema drift')) return 'skill-lib report schema identity mismatch';
  if (message.includes('skill-lib portfolio script drift')) return 'skill-lib portfolio projection identity mismatch';
  if (message.includes('no repository plan reports could be collected')) return 'repository plan reports unavailable';
  if (message.includes('repo report identifies') || message.includes('expected base64 GitHub contents response')) return `${scope} report invalid or unavailable`;
  if (message.includes('Python interpreter') || message.includes('portfolio projection')) return 'skill-lib portfolio projection execution failed';
  return `${scope} unavailable`;
}

function decodeContent(response, label) {
  if (!response?.content || response.encoding !== 'base64') {
    throw new Error(`${label}: expected base64 GitHub contents response`);
  }
  return Buffer.from(response.content, 'base64').toString('utf8');
}

function runPortfolio(scriptPath, reportPaths, outputPath) {
  let lastError = null;
  for (const executable of ['python3', 'python']) {
    try {
      execFileSync(executable, [scriptPath, ...reportPaths, '--output', outputPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
      return executable;
    } catch (error) {
      lastError = error;
      if (error?.code !== 'ENOENT') break;
    }
  }
  throw lastError || new Error('no Python interpreter available for skill-lib portfolio projection');
}

async function collectReport(definition, workDir) {
  let text;
  let reportBlob = null;
  if (definition.localReport) {
    text = await readFile(localReportPath, 'utf8');
  } else {
    const response = getJson(githubApiUrl(
      `/repos/${encodeURIComponent(org)}/${encodeURIComponent(definition.name)}/contents/docs/work-graphs/repository-plan-report.json`,
      { ref: 'main' }
    ));
    reportBlob = response.sha || null;
    text = decodeContent(response, definition.repository);
  }
  const report = JSON.parse(text);
  if (report.repository !== definition.repository) {
    throw new Error(`${definition.repository}: repo report identifies ${report.repository || 'hmmm'}`);
  }
  const reportPath = path.join(workDir, `${definition.slug}.repository-plan-report.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, reportPath, reportBlob };
}

function collectTelemetry(definition) {
  const repo = getJson(githubApiUrl(`/repos/${encodeURIComponent(org)}/${encodeURIComponent(definition.name)}`));
  const branch = repo.default_branch || 'main';
  const commit = getJson(githubApiUrl(`/repos/${encodeURIComponent(org)}/${encodeURIComponent(definition.name)}/commits/${encodeURIComponent(branch)}`));
  const pulls = tryGetJson(githubApiUrl(`/repos/${encodeURIComponent(org)}/${encodeURIComponent(definition.name)}/pulls`, {
    state: 'open',
    per_page: 100
  })) || [];
  const runResponse = tryGetJson(githubApiUrl(`/repos/${encodeURIComponent(org)}/${encodeURIComponent(definition.name)}/actions/runs`, {
    branch,
    per_page: 1
  }));
  const latestRun = runResponse?.workflow_runs?.[0] || null;
  return {
    branch,
    head: commit.sha || null,
    parents: (commit.parents || []).map(parent => parent.sha).filter(Boolean),
    changedFiles: (commit.files || []).map(file => file.filename).filter(Boolean),
    headDate: commit.commit?.committer?.date || commit.commit?.author?.date || null,
    pushedAt: repo.pushed_at || null,
    updatedAt: repo.updated_at || null,
    openPullRequests: Array.isArray(pulls) ? pulls.length : null,
    latestWorkflow: latestRun ? {
      name: latestRun.name || null,
      status: latestRun.status || null,
      conclusion: latestRun.conclusion || null,
      event: latestRun.event || null,
      headSha: latestRun.head_sha || null,
      updatedAt: latestRun.updated_at || null,
      url: latestRun.html_url || null
    } : null
  };
}

function projectView(definition, reportRecord, telemetry, portfolioView) {
  const sourceCommit = reportRecord?.report?.source?.commit || null;
  const head = telemetry?.head || null;
  const reportOnlyRefresh = Boolean(
    sourceCommit &&
    head &&
    (telemetry?.parents || []).includes(sourceCommit) &&
    (telemetry?.changedFiles || []).length === 1 &&
    telemetry.changedFiles[0] === localReportPath
  );
  let reportFreshness = 'unknown';
  if (sourceCommit && head) reportFreshness = sourceCommit === head || reportOnlyRefresh ? 'current' : 'HEAD differs';
  else if (!reportRecord) reportFreshness = 'missing';
  return {
    ...definition,
    report: reportRecord?.report || null,
    reportBlob: reportRecord?.reportBlob || null,
    portfolio: portfolioView || null,
    telemetry: telemetry || null,
    reportFreshness
  };
}

async function writeGenerated(data, persistSnapshot = false) {
  await mkdir('src/_data/generated', { recursive: true });
  await mkdir('src/_data/snapshots', { recursive: true });
  await writeFile('src/_data/generated/sitrep.json', `${JSON.stringify(data, null, 2)}\n`);
  if (persistSnapshot) {
    await writeFile('src/_data/snapshots/sitrep.last-known-good.json', `${JSON.stringify(data, null, 2)}\n`);
  }
}

async function fallbackData(reason) {
  try {
    const previous = JSON.parse(await readFile('src/_data/snapshots/sitrep.last-known-good.json', 'utf8'));
    return {
      ...previous,
      snapshotAt: new Date().toISOString(),
      fallback: true,
      fallbackReason: reason,
      sourceSnapshotAt: previous.snapshotAt || null
    };
  } catch {
    return {
      schema: 'the-interdependency.website-sitrep-view',
      version: '1.0.0',
      snapshotAt: new Date().toISOString(),
      fallback: true,
      fallbackReason: reason,
      sourceSnapshotAt: null,
      controlPlane,
      portfolio: null,
      missingReports: projectDefinitions.map(project => project.repository),
      projects: projectDefinitions.map(project => ({
        ...project,
        report: null,
        portfolio: null,
        telemetry: null,
        reportFreshness: 'unknown'
      }))
    };
  }
}

let workDir = null;
try {
  if (process.env.OFFLINE === '1') throw new Error('offline requested');
  workDir = await mkdtemp(path.join(tmpdir(), 'interdependency-sitrep-'));

  const schemaResponse = getJson(githubApiUrl(
    `/repos/${encodeURIComponent(org)}/skill-lib/contents/${controlPlane.reportSchemaPath}`,
    { ref: controlPlane.commit }
  ));
  if (schemaResponse.sha !== controlPlane.reportSchemaBlob) {
    throw new Error(`skill-lib report schema drift: expected ${controlPlane.reportSchemaBlob}, got ${schemaResponse.sha || 'hmmm'}`);
  }

  const scriptResponse = getJson(githubApiUrl(
    `/repos/${encodeURIComponent(org)}/skill-lib/contents/${controlPlane.portfolioScriptPath}`,
    { ref: controlPlane.commit }
  ));
  if (scriptResponse.sha !== controlPlane.portfolioScriptBlob) {
    throw new Error(`skill-lib portfolio script drift: expected ${controlPlane.portfolioScriptBlob}, got ${scriptResponse.sha || 'hmmm'}`);
  }
  const portfolioScript = path.join(workDir, 'portfolio_plan.py');
  await writeFile(portfolioScript, decodeContent(scriptResponse, 'skill-lib portfolio_plan.py'));

  const reportRecords = new Map();
  const missingReports = [];
  for (const definition of projectDefinitions) {
    try {
      reportRecords.set(definition.repository, await collectReport(definition, workDir));
    } catch (error) {
      missingReports.push({ repository: definition.repository, reason: publicFailureReason(error, definition.repository) });
    }
  }
  if (reportRecords.size === 0) throw new Error('no repository plan reports could be collected');

  const portfolioOutput = path.join(workDir, 'portfolio-plan.json');
  const python = runPortfolio(
    portfolioScript,
    [...reportRecords.values()].map(record => record.reportPath),
    portfolioOutput
  );
  const portfolio = JSON.parse(await readFile(portfolioOutput, 'utf8'));

  const portfolioByRepo = new Map((portfolio.repositories || []).map(item => [item.repository, item]));
  const telemetry = new Map();
  for (const definition of projectDefinitions) {
    try { telemetry.set(definition.repository, collectTelemetry(definition)); }
    catch { telemetry.set(definition.repository, null); }
  }

  const data = {
    schema: 'the-interdependency.website-sitrep-view',
    version: '1.0.0',
    snapshotAt: new Date().toISOString(),
    fallback: false,
    fallbackReason: null,
    sourceSnapshotAt: null,
    controlPlane: { ...controlPlane, executor: python },
    portfolio,
    missingReports,
    projects: projectDefinitions.map(definition => projectView(
      definition,
      reportRecords.get(definition.repository),
      telemetry.get(definition.repository),
      portfolioByRepo.get(definition.repository)
    ))
  };
  await writeGenerated(data, true);
  console.log(`sitrep ${data.projects.length} projects, ${missingReports.length} missing report(s), plan ${portfolio.portfolio_plan_sha256}`);
} catch (error) {
  const data = await fallbackData(publicFailureReason(error));
  await writeGenerated(data, false);
  console.log(`sitrep fallback: ${data.fallbackReason}`);
} finally {
  if (workDir) await rm(workDir, { recursive: true, force: true });
}
