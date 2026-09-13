/**
 * Lazy loader for the official sqlite wasm build. Worker-only: nothing in the
 * main bundle may import this module (and with it the wasm binary), so app
 * startup never pays for it — the worker that reaches this file is created on
 * first export.
 */
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';

let instance: Promise<Sqlite3Static> | undefined;

export function getSqlite(): Promise<Sqlite3Static> {
  return (instance ??= import('@sqlite.org/sqlite-wasm').then((mod) => mod.default()));
}
