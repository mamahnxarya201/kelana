import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLICATION_ID,
  CONTAINER_VERSION,
  DDL,
  FORMAT,
  FORMAT_VERSION,
  SQLITE_MAGIC,
  isKelanaFile,
  kelanaFilename,
  slugify,
} from './schema';

test('container constants match the format spec', () => {
  assert.equal(APPLICATION_ID, 0x4b4c4e41);
  assert.equal(CONTAINER_VERSION, 1);
  assert.equal(FORMAT, 'kelana');
  assert.equal(FORMAT_VERSION, '1');
});

test('isKelanaFile sniffs the SQLite magic in the first 16 bytes', () => {
  const header = new TextEncoder().encode(SQLITE_MAGIC);
  assert.equal(isKelanaFile(header), true);
  assert.equal(isKelanaFile(new Uint8Array(0)), false);
  assert.equal(isKelanaFile(header.slice(0, 12)), false);
  const impostor = header.slice();
  impostor[0] = 0x50; // 'P', as in the PK zip magic
  assert.equal(isKelanaFile(impostor), false);
});

test('slugify produces a safe filename stem', () => {
  assert.equal(slugify('Thinking space'), 'thinking-space');
  assert.equal(slugify('Café — a “board”!'), 'cafe-a-board');
  assert.equal(slugify('   '), 'board');
  assert.equal(kelanaFilename('My Board'), 'my-board.kelana');
});

test('DDL declares the five tables with an ISO updated_at column', () => {
  for (const table of ['meta', 'doc', 'assets', 'blobs', 'pdf_text'])
    assert.ok(DDL.includes(`CREATE TABLE ${table}(`), `missing table ${table}`);
  assert.ok(DDL.includes('updated_at TEXT NOT NULL'), 'updated_at must be ISO text');
});
