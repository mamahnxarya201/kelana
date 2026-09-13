/**
 * Pure constants and helpers for the `.kelana` container format — a SQLite
 * database holding the board doc JSON, content-addressed asset blobs, and an
 * optional derived-text cache. kelana-file-format.md is the source of truth.
 *
 * This module must stay dependency-free and runtime-agnostic: it is imported
 * by the worker, the app, and node:test without sqlite or a browser.
 */

/** `PRAGMA application_id` — 'KLNA'. */
export const APPLICATION_ID = 0x4b4c4e41;
/** Bumped only when the container schema/layout below changes. */
export const CONTAINER_VERSION = 1;
/** The doc-shape version this writer emits; mirrors `Doc.version`. */
export const FORMAT_VERSION = '1';
export const FORMAT = 'kelana';
export const GENERATOR_APP = 'kelana';

/** SQLite 3 file header magic; sniffed on import. */
export const SQLITE_MAGIC = 'SQLite format 3\x00';

export const META = {
  format: 'format',
  formatVersion: 'formatVersion',
  generator: 'generator',
  createdAt: 'createdAt',
  title: 'title',
} as const;

/**
 * DDL for a fresh container. Timestamps are ISO 8601 text (`updated_at`,
 * `meta.createdAt`) except `assets.created_at`, which mirrors the epoch-millis
 * `Asset.createdAt` record.
 */
export const DDL = `
CREATE TABLE meta(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE doc(
  id INTEGER PRIMARY KEY CHECK(id = 1),
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE assets(
  checksum TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE blobs(
  checksum TEXT PRIMARY KEY REFERENCES assets(checksum),
  data BLOB NOT NULL
);
CREATE TABLE pdf_text(
  asset_id TEXT PRIMARY KEY,
  text TEXT NOT NULL
);
`.trim();

export function isKelanaFile(bytes: Uint8Array): boolean {
  if (bytes.length < SQLITE_MAGIC.length) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++)
    if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  return true;
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'board';
}

export const kelanaFilename = (title: string) => `${slugify(title)}.kelana`;
