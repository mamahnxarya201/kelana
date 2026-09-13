/// <reference lib="webworker" />
/**
 * Owns the sqlite wasm build and all `.kelana` byte handling, off the main
 * thread. App startup never instantiates this worker (App.svelte creates it on
 * first export); the postMessage protocol below is the only interface —
 * kelana-file-format.md is the source of truth.
 *
 * Phase 1 implements export; import arrives in Phase 2 over the same protocol.
 */
import type { Doc } from '../model';
import { saveAsset, savePdfText, loadAsset, loadAssetMeta, loadPdfText } from '../storage';
import {
  APPLICATION_ID,
  CONTAINER_VERSION,
  DDL,
  FORMAT,
  FORMAT_VERSION,
  GENERATOR_APP,
  META,
  isKelanaFile,
  kelanaFilename,
} from './schema';
import { getSqlite } from './sqlite';

type ExportRequest = { type: 'export'; doc: Doc };
type ImportRequest = { type: 'import'; bytes: ArrayBuffer };
type ContainerRequest = ExportRequest | ImportRequest;

export type ImportStats = {
  cards: number;
  pdfs: number;
  images: number;
  assets: number;
  cachedTexts: number;
};

export type ContainerResponse =
  | { type: 'exported'; bytes: ArrayBuffer; filename: string }
  | { type: 'imported'; doc: Doc; stats: ImportStats }
  | {
      type: 'error';
      code: 'version' | 'corrupt' | 'missing-asset' | 'internal';
      message: string;
    };

class MissingAssetError extends Error {}
class VersionMismatchError extends Error {}
class CorruptFileError extends Error {}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function exportBoard(
  request: ExportRequest,
): Promise<Extract<ContainerResponse, { type: 'exported' }>> {
  const sqlite3 = await getSqlite();
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  try {
    // Collect the referenced assets up front so validation failures abort
    // before anything is written.
    const assetIds = new Set<string>();
    for (const entity of Object.values(request.doc.entities))
      if (entity.assetId) assetIds.add(entity.assetId);

    db.exec('BEGIN');
    try {
      db.exec(`PRAGMA journal_mode=MEMORY;`); // meaningless in memory; kept for the live-file path.
      db.exec(DDL);
      db.exec(`PRAGMA application_id=${APPLICATION_ID};`);
      db.exec(`PRAGMA user_version=${CONTAINER_VERSION};`);

      const metaRows: Record<string, string> = {
        [META.format]: FORMAT,
        [META.formatVersion]: FORMAT_VERSION,
        [META.generator]: `${GENERATOR_APP} ${__KELANA_VERSION__}`,
        [META.createdAt]: new Date().toISOString(),
        [META.title]: request.doc.title,
      };
      for (const [key, value] of Object.entries(metaRows))
        db.exec({ sql: 'INSERT INTO meta(key, value) VALUES (?, ?)', bind: [key, value] });

      db.exec({
        sql: 'INSERT INTO doc(id, json, updated_at) VALUES (1, ?, ?)',
        bind: [JSON.stringify(request.doc), new Date().toISOString()],
      });

      const writtenChecksums = new Set<string>();
      for (const assetId of assetIds) {
        const meta = await loadAssetMeta(assetId);
        if (!meta) throw new MissingAssetError(assetId);
        const blob = await loadAsset(assetId);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        // The file's primary key is the hash of the bytes we actually write,
        // so the content-address invariant holds regardless of stored metadata.
        const checksum = await sha256Hex(bytes);
        if (writtenChecksums.has(checksum)) continue;
        writtenChecksums.add(checksum);
        db.exec({
          sql: 'INSERT INTO assets(checksum, mime, byte_size, created_at) VALUES (?, ?, ?, ?)',
          bind: [
            checksum,
            meta.mimeType || 'application/octet-stream',
            bytes.byteLength,
            meta.createdAt,
          ],
        });
        db.exec({ sql: 'INSERT INTO blobs(checksum, data) VALUES (?, ?)', bind: [checksum, bytes] });
        const text = await loadPdfText(assetId);
        if (text !== undefined)
          db.exec({
            sql: 'INSERT INTO pdf_text(asset_id, text) VALUES (?, ?)',
            bind: [assetId, text],
          });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    const bytes = sqlite3.capi.sqlite3_js_db_export(db);
    return { type: 'exported', bytes: bytes.buffer, filename: kelanaFilename(request.doc.title) };
  } finally {
    db.close();
  }
}

/** Run a query and collect its rows as plain arrays. */
type SQLITE_DB = InstanceType<import('@sqlite.org/sqlite-wasm').Sqlite3Static['oo1']['DB']>;
function queryRows(db: SQLITE_DB, sql: string, bind: readonly unknown[] = []) {
  return db.exec({
    sql,
    bind: bind as import('@sqlite.org/sqlite-wasm').BindingSpec,
    rowMode: 'array',
    returnValue: 'resultRows',
  }) as unknown[][];
}

async function importBoard(request: ImportRequest): Promise<ContainerResponse> {
  const sqlite3 = await getSqlite();
  const bytes = new Uint8Array(request.bytes);
  if (!isKelanaFile(bytes))
    throw new CorruptFileError('This file is not a Kelana board (no SQLite database header).');

  const db = new sqlite3.oo1.DB(':memory:', 'c');
  try {
    // Hand the image to the handle; FREEONCLOSE (1) transfers ownership and
    // READONLY (2) keeps import validation from ever writing into the file.
    const pData = sqlite3.wasm.allocFromTypedArray(bytes);
    const rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer!,
      'main',
      pData,
      bytes.byteLength,
      bytes.byteLength,
      3,
    );
    if (rc) {
      sqlite3.wasm.dealloc(pData);
      throw new CorruptFileError('The board file could not be opened as a database.');
    }

    const userVersion = queryRows(db, 'PRAGMA user_version')[0]?.[0];
    if (typeof userVersion !== 'number' || Number.isNaN(userVersion))
      throw new CorruptFileError('The board file has no container version.');
    if (userVersion > CONTAINER_VERSION)
      throw new VersionMismatchError(
        'This board file was written by a newer version of Kelana. Update the app to open it.',
      );
    if (userVersion !== CONTAINER_VERSION)
      throw new CorruptFileError(`Unknown container version ${userVersion}.`);

    const meta = Object.fromEntries(
      queryRows(db, 'SELECT key, value FROM meta').map(([key, value]) => [key, value]),
    );
    if (meta[META.format] !== FORMAT)
      throw new CorruptFileError('This database is not a Kelana board file.');
    if (meta[META.formatVersion] !== FORMAT_VERSION)
      throw new VersionMismatchError(
        'This board file uses a document format from a different version of Kelana.',
      );

    const docRow = queryRows(db, 'SELECT json FROM doc WHERE id = 1')[0];
    if (!docRow) throw new CorruptFileError('The board file contains no board document.');
    let doc: Doc;
    try {
      doc = JSON.parse(docRow[0] as string) as Doc;
    } catch {
      throw new CorruptFileError('The board document inside the file is damaged.');
    }
    if (typeof doc !== 'object' || doc === null || typeof doc.version !== 'number')
      throw new CorruptFileError('The board document inside the file is damaged.');
    if (doc.version > 1)
      throw new VersionMismatchError(
        'This board uses features from a newer version of Kelana. Update the app to open it.',
      );
    if (
      typeof doc.entities !== 'object' ||
      doc.entities === null ||
      !Array.isArray(doc.placements) ||
      !Array.isArray(doc.edges)
    )
      throw new CorruptFileError('The board document inside the file is damaged.');

    // Validate before anything is ingested: every referenced assetId must
    // exist in the file's assets table.
    const referenced = new Map<string, string>(); // entity assetId → checksum
    for (const entity of Object.values(doc.entities)) {
      if (!entity.assetId) continue;
      const checksum = entity.assetId.replace(/^asset:/, '').toLowerCase();
      referenced.set(entity.assetId, checksum);
    }
    const assetRows = queryRows(db, 'SELECT checksum, mime, byte_size FROM assets');
    const knownChecksums = new Set(assetRows.map((row) => row[0] as string));
    const missing = [...referenced.values()].filter((checksum) => !knownChecksums.has(checksum));
    if (missing.length)
      throw new MissingAssetError(
        `The board file is missing assets it references (${missing
          .slice(0, 3)
          .map((checksum) => checksum.slice(0, 8) + '…')
          .join(', ')}).`,
      );

    // Content-address invariant: recompute every blob's SHA-256 against its
    // row. All verification happens before any ingestion.
    const blobRows = new Map<string, Uint8Array<ArrayBufferLike>>();
    for (const [checksum, byteSize] of queryRows(
      db,
      'SELECT checksum, byte_size FROM assets',
    ) as [string, number][]) {
      const row = queryRows(db, 'SELECT data FROM blobs WHERE checksum = ?', [checksum])[0];
      const data = row?.[0];
      if (!(data instanceof Uint8Array))
        throw new CorruptFileError(`The file has no bytes for asset ${checksum.slice(0, 8)}….`);
      if (data.byteLength !== byteSize)
        throw new CorruptFileError(`Asset ${checksum.slice(0, 8)}… has the wrong byte size.`);
      if ((await sha256Hex(data)) !== checksum)
        throw new CorruptFileError(`Asset ${checksum.slice(0, 8)}… does not match its checksum.`);
      blobRows.set(checksum, data);
    }

    // Ingestion is additive and deduped via saveAsset; the board is adopted
    // only after every step above succeeded.
    for (const [checksum, mime, byteSize] of assetRows as [string, string, number][]) {
      const data = blobRows.get(checksum)!;
      await saveAsset(
        new File([data as unknown as BlobPart], checksum, {
          type: mime || 'application/octet-stream',
        }),
      );
    }
    let cachedTexts = 0;
    for (const [assetId, text] of queryRows(db, 'SELECT asset_id, text FROM pdf_text') as [
      string,
      string,
    ][]) {
      await savePdfText(assetId, text);
      cachedTexts++;
    }

    // Canonicalize entity references to the content address of the bytes we
    // just verified and stored.
    for (const entity of Object.values(doc.entities)) {
      if (entity.assetId) entity.assetId = `asset:${referenced.get(entity.assetId)}`;
    }

    const counts = { cards: 0, pdfs: 0, images: 0 };
    for (const entity of Object.values(doc.entities)) {
      if (entity.type === 'pdf') counts.pdfs++;
      else if (entity.type === 'image') counts.images++;
      else counts.cards++;
    }
    const stats: ImportStats = { ...counts, assets: assetRows.length, cachedTexts };
    return { type: 'imported', doc, stats };
  } finally {
    db.close();
  }
}

self.onmessage = async (event: MessageEvent<ContainerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'export') {
      const response = await exportBoard(request);
      (self as unknown as Worker).postMessage(response, [response.bytes]);
    } else if (request.type === 'import') {
      self.postMessage(await importBoard(request));
    }
  } catch (error) {
    const code =
      error instanceof MissingAssetError
        ? 'missing-asset'
        : error instanceof VersionMismatchError
          ? 'version'
          : error instanceof CorruptFileError
            ? 'corrupt'
            : 'internal';
    const fallback = 'The board file could not be opened.';
    const message =
      error instanceof MissingAssetError
        ? error.message
        : error instanceof VersionMismatchError || error instanceof CorruptFileError
          ? error.message
          : `Could not read the board file: ${(error as Error).message ?? error}`;
    self.postMessage({ type: 'error', code, message: message || fallback } satisfies ContainerResponse);
  }
};
