export type Bump = 'none' | 'patch' | 'minor' | 'major';
export interface Commit {
  hash: string;
  subject: string;
  body: string;
}
export interface ClassifiedCommit extends Commit {
  type: string;
  scope: string;
  description: string;
  breaking: boolean;
  bump: Bump;
}
export function classify(commit: Commit): ClassifiedCommit;
export function highestBump(bumps: Bump[]): Bump;
export function parseVersion(v: string): { major: number; minor: number; patch: number; pre: string };
export function compareVersions(a: string, b: string): number;
export function bumpVersion(version: string, bump: Bump): string;
export function nextRelease(input: {
  lastTag: string | null;
  packageVersion: string;
  commits: Commit[];
  requested?: 'auto' | Bump;
}): {
  version: string;
  previous: string | null;
  bump: Bump;
  releasable: boolean;
  commits: ClassifiedCommit[];
};
export function renderNotes(
  commits: ClassifiedCommit[],
  meta: { repoUrl?: string; version: string; previous: string | null },
): string;
export function changelogSection(changelog: string, version: string): string | null;
