// Tiny JSON file store in the user data directory with atomic writes.
import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export function dataPath(name: string): string {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

export function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(dataPath(name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeText(name: string, text: string): void {
  const file = dataPath(name);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, file);
}

export function writeJson(name: string, value: unknown): void {
  writeText(name, JSON.stringify(value, null, 2));
}

export function readText(name: string): string | null {
  const file = dataPath(name);
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function remove(name: string): void {
  rmSync(dataPath(name), { force: true });
}
