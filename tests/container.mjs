/**
 * Cross-implementation container check: verifies a `.kelana` file written by
 * the app's sqlite-wasm worker using node's better-sqlite3 (and the raw bytes).
 *
 * Run directly:  npm run test:container -- path/to/board.kelana
 * Also imported by tests/kelana-file.browser.mjs to verify the file the browser
 * just exported.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const SQLITE_MAGIC = 'SQLite format 3\x00';
const APPLICATION_ID = 0x4b4c4e41; // 'KLNA'
const CONTAINER_VERSION = 1;

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * Asserts the schema, metadata, and content-address invariants of a `.kelana`
 * byte stream. `expected`: { title, entityTypes: {type: count}, minAssets,
 * pdfTextIncludes }. Returns { meta, doc, assetCount }.
 */
export function verifyKelanaBytes(bytes, expected = {}) {
  const problems = [];
  const check = (condition, message) => {
    if (!condition) problems.push(message);
  };

  check(bytes.length > 100, 'file is too small to be a SQLite database');
  check(bytes.subarray(0, 16).toString('latin1') === SQLITE_MAGIC, 'missing SQLite magic header');

  const db = new Database(bytes);
  try {
    const applicationId = db.pragma('application_id', { simple: true });
    check(
      applicationId === APPLICATION_ID,
      `application_id is 0x${(applicationId >>> 0).toString(16)}, expected 0x4b4c4e41`,
    );
    const userVersion = db.pragma('user_version', { simple: true });
    check(userVersion === CONTAINER_VERSION, `user_version is ${userVersion}, expected ${CONTAINER_VERSION}`);

    const meta = Object.fromEntries(
      db.prepare('SELECT key, value FROM meta').all().map((row) => [row.key, row.value]),
    );
    check(meta.format === 'kelana', `meta.format is ${JSON.stringify(meta.format)}`);
    check(meta.formatVersion === '1', `meta.formatVersion is ${JSON.stringify(meta.formatVersion)}`);
    check(
      typeof meta.generator === 'string' && meta.generator.startsWith('kelana '),
      `meta.generator is ${JSON.stringify(meta.generator)}`,
    );
    check(!Number.isNaN(Date.parse(meta.createdAt)), 'meta.createdAt is not ISO 8601');
    if (expected.title)
      check(meta.title === expected.title, `meta.title is ${JSON.stringify(meta.title)}`);

    const docRow = db.prepare('SELECT json, updated_at FROM doc WHERE id = 1').get();
    check(docRow, 'doc row (id=1) is missing');
    const doc = docRow ? JSON.parse(docRow.json) : { entities: {} };
    check(
      typeof doc.title === 'string' && Array.isArray(doc.placements),
      'doc.json does not look like a Doc',
    );
    check(!Number.isNaN(Date.parse(docRow?.updated_at)), 'doc.updated_at is not ISO 8601');
    if (expected.entityTypes) {
      const counts = {};
      for (const entity of Object.values(doc.entities)) counts[entity.type] = (counts[entity.type] ?? 0) + 1;
      for (const [type, count] of Object.entries(expected.entityTypes)) {
        check(
          (counts[type] ?? 0) >= count,
          `expected at least ${count} ${type} entity(ies) in doc.json, got ${counts[type] ?? 0}`,
        );
      }
    }

    const assets = db.prepare('SELECT checksum, mime, byte_size FROM assets').all();
    const blobStmt = db.prepare('SELECT data FROM blobs WHERE checksum = ?');
    for (const asset of assets) {
      const blob = blobStmt.get(asset.checksum);
      const short = asset.checksum.slice(0, 8);
      check(blob, `assets row ${short}… has no matching blobs row`);
      if (!blob) continue;
      check(
        blob.data.length === asset.byte_size,
        `byte_size ${asset.byte_size} != length(data) ${blob.data.length} for ${short}…`,
      );
      check(sha256(blob.data) === asset.checksum, `sha256(data) != checksum for ${short}…`);
    }

    // Every assetId referenced by an entity must exist; nothing unreferenced
    // may be exported (export doubles as compaction).
    const referenced = new Set(
      Object.values(doc.entities)
        .filter((entity) => entity.assetId)
        .map((entity) => entity.assetId.replace(/^asset:/, '')),
    );
    const checksums = new Set(assets.map((asset) => asset.checksum));
    for (const checksum of referenced) {
      check(
        checksums.has(checksum),
        `referenced asset asset:${checksum.slice(0, 8)}… is missing from the assets table`,
      );
      if (checksums.has(checksum)) {
        const row = blobStmt.get(checksum);
        check(
          row && sha256(row.data) === checksum,
          `blob bytes for referenced asset:${checksum.slice(0, 8)}… do not hash to their id`,
        );
      }
    }
    const orphans = assets.filter((asset) => !referenced.has(asset.checksum));
    check(
      orphans.length === 0,
      `unreferenced assets were exported: ${orphans.map((a) => a.checksum.slice(0, 8) + '…').join(', ')}`,
    );

    if (expected.minAssets)
      check(assets.length >= expected.minAssets, `expected ≥ ${expected.minAssets} assets, got ${assets.length}`);
    if (expected.pdfTextIncludes) {
      const texts = db.prepare('SELECT text FROM pdf_text').all().map((row) => row.text);
      check(
        texts.some((text) => text.includes(expected.pdfTextIncludes)),
        `no pdf_text row contains ${JSON.stringify(expected.pdfTextIncludes)}`,
      );
    }

    return { problems, meta, doc, assetCount: assets.length };
  } finally {
    db.close();
  }
}

export function verifyKelanaFile(path, expected) {
  return verifyKelanaBytes(readFileSync(path), expected);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node tests/container.mjs <board.kelana>');
    process.exit(1);
  }
  const { problems, meta, assetCount } = verifyKelanaFile(path);
  if (problems.length) {
    for (const problem of problems) console.error('FAIL', problem);
    process.exit(1);
  }
  console.log(`ok  ${path} — title ${JSON.stringify(meta.title)}, ${assetCount} asset(s)`);
}
