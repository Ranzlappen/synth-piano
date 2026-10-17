import { describe, expect, it } from 'vitest';
import {
  bumpVersion,
  changelogSection,
  classify,
  compareVersions,
  nextRelease,
  renderNotes,
} from '../../scripts/release-utils.mjs';

const c = (subject: string, body = '', hash = 'abcdef1234567890') => ({ hash, subject, body });

describe('release versioning', () => {
  it('classifies conventional commits', () => {
    expect(classify(c('feat(export): add PDF')).bump).toBe('minor');
    expect(classify(c('fix: crash')).bump).toBe('patch');
    expect(classify(c('docs: readme')).bump).toBe('none');
    expect(classify(c('feat!: new format')).bump).toBe('major');
    expect(classify(c('refactor: x', 'BREAKING CHANGE: removed y')).bump).toBe('major');
    expect(classify(c('Update README.md')).type).toBe('other');
  });

  it('bumps and compares versions', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0-beta.1', '2.0.0')).toBeLessThan(0);
  });

  it('decides the next release', () => {
    expect(nextRelease({ lastTag: null, packageVersion: '2.0.0', commits: [] })).toMatchObject({
      version: '2.0.0',
      releasable: true,
    });
    expect(
      nextRelease({ lastTag: 'v2.0.0', packageVersion: '2.0.0', commits: [c('fix: a'), c('feat: b')] }),
    ).toMatchObject({
      version: '2.1.0',
      bump: 'minor',
      releasable: true,
    });
    expect(
      nextRelease({ lastTag: 'v2.1.0', packageVersion: '2.0.0', commits: [c('docs: a'), c('chore: b')] }),
    ).toMatchObject({
      version: '2.1.0',
      releasable: false,
    });
    expect(
      nextRelease({ lastTag: 'v2.1.0', packageVersion: '2.0.0', commits: [c('docs: a')], requested: 'patch' })
        .version,
    ).toBe('2.1.1');
    expect(nextRelease({ lastTag: 'v2.1.0', packageVersion: '3.0.0', commits: [c('fix: a')] }).version).toBe(
      '3.0.0',
    );
  });

  it('renders grouped release notes', () => {
    const commits = [
      c('feat(roll): zoom'),
      c('fix: stuck notes'),
      c('chore: deps'),
      c('feat!: v2 project format'),
    ].map(classify);
    const notes = renderNotes(commits, {
      repoUrl: 'https://github.com/o/r',
      version: '3.0.0',
      previous: '2.0.0',
    });
    expect(notes).toContain('Breaking changes');
    expect(notes).toContain('**roll:** zoom');
    expect(notes).toContain('stuck notes');
    expect(notes).not.toContain('deps');
    expect(notes).toContain('compare/v2.0.0...v3.0.0');
  });

  it('reads curated notes from the changelog', () => {
    const log = '# Changelog\n\n## [2.1.0] - 2026-11-01\n\n- New thing\n\n## [2.0.0]\n\n- First\n';
    expect(changelogSection(log, '2.1.0')).toContain('New thing');
    expect(changelogSection(log, '2.1.0')).not.toContain('First');
    expect(changelogSection(log, '2.0.0')).toBe('- First');
    expect(changelogSection(log, '9.9.9')).toBeNull();
  });
});
