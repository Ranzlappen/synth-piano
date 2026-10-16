// Pure helpers for automatic versioning from Conventional Commits.
// feat -> minor, fix/perf/refactor/revert -> patch, "!" or BREAKING CHANGE -> major.

/** @typedef {{ hash: string, subject: string, body: string }} Commit */
/** @typedef {'none' | 'patch' | 'minor' | 'major'} Bump */

const ORDER = { none: 0, patch: 1, minor: 2, major: 3 };
const HEADER = /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?:\s*(?<description>.+)$/;

/** @param {Commit} commit */
export function classify(commit) {
  const m = HEADER.exec(commit.subject.trim());
  const breaking = Boolean(m?.groups?.breaking) || /^BREAKING[ -]CHANGE:/m.test(commit.body);
  const type = (m?.groups?.type ?? 'other').toLowerCase();
  /** @type {Bump} */
  let bump = 'none';
  if (breaking) bump = 'major';
  else if (type === 'feat') bump = 'minor';
  else if (['fix', 'perf', 'refactor', 'revert'].includes(type)) bump = 'patch';
  return {
    ...commit,
    type,
    scope: m?.groups?.scope ?? '',
    description: m?.groups?.description ?? commit.subject.trim(),
    breaking,
    bump,
  };
}

/** @param {Bump[]} bumps */
export function highestBump(bumps) {
  return bumps.reduce((a, b) => (ORDER[b] > ORDER[a] ? b : a), /** @type {Bump} */ ('none'));
}

/** @param {string} v */
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim());
  if (!m) throw new Error(`Invalid version: ${v}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? '' };
}

/** @param {string} a @param {string} b */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (const k of /** @type {const} */ (['major', 'minor', 'patch'])) if (x[k] !== y[k]) return x[k] - y[k];
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** @param {string} version @param {Bump} bump */
export function bumpVersion(version, bump) {
  const v = parseVersion(version);
  if (bump === 'major') return `${v.major + 1}.0.0`;
  if (bump === 'minor') return `${v.major}.${v.minor + 1}.0`;
  if (bump === 'patch') return `${v.major}.${v.minor}.${v.patch + 1}`;
  return `${v.major}.${v.minor}.${v.patch}`;
}

/**
 * Decides the next release.
 * @param {{ lastTag: string | null, packageVersion: string, commits: Commit[], requested?: 'auto' | Bump }} input
 */
export function nextRelease({ lastTag, packageVersion, commits, requested = 'auto' }) {
  const classified = commits.map(classify);
  const previous = lastTag ? parseVersion(lastTag) && lastTag.replace(/^v/, '') : null;
  if (!previous) {
    // First release: publish the version from package.json as-is.
    return { version: packageVersion, previous: null, bump: 'none', releasable: true, commits: classified };
  }
  const auto = highestBump(classified.map((c) => c.bump));
  const bump = requested === 'auto' ? auto : requested;
  let version = bumpVersion(previous, bump);
  // A version raised by hand in package.json wins over the computed one.
  if (compareVersions(packageVersion, version) > 0) version = packageVersion;
  const releasable = compareVersions(version, previous) > 0;
  return { version, previous, bump, releasable, commits: classified };
}

const SECTIONS = [
  ['breaking', '⚠️ Breaking changes'],
  ['feat', '✨ New features'],
  ['fix', '🐛 Fixes'],
  ['perf', '⚡ Performance'],
  ['other', '🧰 Other changes'],
];

/**
 * Markdown release notes grouped by change type.
 * @param {ReturnType<typeof classify>[]} commits
 * @param {{ repoUrl?: string, version: string, previous: string | null }} meta
 */
export function renderNotes(commits, { repoUrl, version, previous }) {
  const groups = new Map(SECTIONS.map(([k]) => [k, /** @type {string[]} */ ([])]));
  for (const c of commits) {
    if (/^(chore|ci|build|test|style)$/.test(c.type) && !c.breaking) continue;
    if (/^Merge (pull request|branch)/.test(c.subject)) continue;
    const key = c.breaking ? 'breaking' : ['feat', 'fix', 'perf'].includes(c.type) ? c.type : 'other';
    const short = c.hash.slice(0, 7);
    const link = repoUrl ? `[\`${short}\`](${repoUrl}/commit/${c.hash})` : `\`${short}\``;
    groups.get(key).push(`- ${c.scope ? `**${c.scope}:** ` : ''}${c.description} (${link})`);
  }
  const parts = [];
  for (const [key, title] of SECTIONS) {
    const items = groups.get(key);
    if (items.length) parts.push(`### ${title}\n\n${items.join('\n')}`);
  }
  if (!parts.length) parts.push('Maintenance release.');
  if (repoUrl && previous) parts.push(`**Full changelog:** ${repoUrl}/compare/v${previous}...v${version}`);
  return parts.join('\n\n');
}

/**
 * Extracts the body of "## [1.2.3]" (or "## 1.2.3" / "## v1.2.3") from a changelog.
 * @param {string} changelog @param {string} version
 */
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const escaped = version.replace(/\./g, '\\.');
  const head = new RegExp(`^##\\s+\\[?v?${escaped}\\]?(\\s|$)`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  const body = lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
  return body || null;
}
