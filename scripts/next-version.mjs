#!/usr/bin/env node
// Computes the next release version from Conventional Commits since the last v* tag.
// Usage: node scripts/next-version.mjs [auto|patch|minor|major] [--github-output]
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { changelogSection, nextRelease, renderNotes } from './release-utils.mjs';

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const requested = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'auto';
if (!['auto', 'patch', 'minor', 'major'].includes(requested)) {
  console.error(`Unknown bump "${requested}"`);
  process.exit(1);
}

let lastTag;
try {
  lastTag = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*');
} catch {
  lastTag = null; // no release yet
}
const range = lastTag ? [`${lastTag}..HEAD`] : ['HEAD'];
const raw = git('log', ...range, '--format=%H%x1f%s%x1f%b%x1e');
const commits = raw
  .split('\x1e')
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => {
    const [hash, subject, body] = r.split('\x1f');
    return { hash, subject: subject ?? '', body: body ?? '' };
  });
const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const result = nextRelease({ lastTag, packageVersion, commits, requested });
// Never publish a version whose tag already exists.
if (result.releasable && git('tag', '--list', `v${result.version}`)) result.releasable = false;
const repoUrl = process.env.GITHUB_REPOSITORY
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
  : undefined;
// A hand-written CHANGELOG.md section for the version takes precedence over generated notes.
const changelogFile = new URL('../CHANGELOG.md', import.meta.url);
const curated = existsSync(changelogFile)
  ? changelogSection(readFileSync(changelogFile, 'utf8'), result.version)
  : null;
const notes =
  curated ?? renderNotes(result.commits, { repoUrl, version: result.version, previous: result.previous });

console.log(`Last tag: ${lastTag ?? '(none)'}  commits: ${commits.length}  bump: ${result.bump}`);
console.log(`Next version: ${result.version}${result.releasable ? '' : ' (nothing to release)'}`);
console.log(`\n${notes}\n`);

if (process.argv.includes('--github-output') && process.env.GITHUB_OUTPUT) {
  const delimiter = `NOTES_${Date.now()}`;
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${result.version}\nreleasable=${result.releasable}\nprevious=${result.previous ?? ''}\nnotes<<${delimiter}\n${notes}\n${delimiter}\n`,
  );
}
