/**
 * Browser behavior test for the `.kelana` file menu (Phase 1). Run with:
 *   npm run test:browser
 *
 * Builds a board (PDF + image + annotation), drives the hamburger file menu
 * and the Ctrl+S shortcut, captures the exported download, and verifies the
 * wasm-written file cross-implementation with better-sqlite3 (see
 * tests/container.mjs). Uses the system Chrome; no browser downloads.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { verifyKelanaFile } from './container.mjs';

const PORT = 5199;
const BASE = `http://localhost:${PORT}/`;
const EXPORT_NAME = 'thinking-space.kelana'; // slug of the seeded board title

function startDevServer() {
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite did not start in time')), 30000);
    const onData = (d) => {
      if (d.toString().includes('Local:')) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => reject(new Error(`vite exited early (${code})`)));
  });
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL  ${name}\n      ${e.message}`);
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** Minimal single-page PDF with extractable text, built with a correct xref. */
function tinyPdf(text) {
  const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const run = async () => {
  const server = await startDevServer();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    // The native save picker cannot be automated; shadow it so the export path
    // runs end-to-end through the download fallback instead.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
    });
    const wasmRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('sqlite3')) wasmRequests.push(request.url());
    });
    page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.load-cover', { state: 'detached', timeout: 15000 });

    const pdfBytes = tinyPdf('Kelana highlight test');
    const pdfChecksum = createHash('sha256').update(pdfBytes).digest('hex');
    const tmp = await mkdtemp(join(tmpdir(), 'kelana-export-'));

    await test('startup does not load the container worker or the wasm', async () => {
      assert(
        wasmRequests.length === 0,
        `sqlite3 assets requested at startup: ${wasmRequests.join(', ')}`,
      );
    });

    await test('importing a PDF and an image puts both on the board', async () => {
      await page.setInputFiles('.file-input', [
        { name: 'sample.pdf', mimeType: 'application/pdf', buffer: pdfBytes },
        { name: 'dot.png', mimeType: 'image/png', buffer: PNG },
      ]);
      await page.waitForSelector('.board-card[aria-label="sample.pdf"]', { timeout: 10000 });
      await page.waitForSelector('.board-card[aria-label="dot.png"]', { timeout: 10000 });
    });

    await test('pdf text is indexed into the cache', async () => {
      const assetKey = `asset:${pdfChecksum}`;
      await page.waitForFunction(
        async (key) => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('kelana-local', 2);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const text = await new Promise((resolve, reject) => {
            const request = db.transaction('search').objectStore('search').get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          db.close();
          return typeof text === 'string' && text.length > 0;
        },
        assetKey,
        { timeout: 15000 },
      );
    });

    let annotationQuote = '';
    await test('selecting text in the reader creates an annotation', async () => {
      // Park the image card away so it cannot cover the PDF card or its menu.
      // Grab the card center: the top-left corner hosts the open-in-workbench
      // button, and a corner grab would click chrome instead of dragging.
      const image = await page.$('.board-card[aria-label="dot.png"]');
      const ib = await image.boundingBox();
      await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
      await page.mouse.down();
      await page.mouse.move(ib.x + ib.width / 2 + 420, ib.y + ib.height / 2 + 420, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      await page.click('.board-card[aria-label="sample.pdf"]', { button: 'right' });
      await page.click('text=Open in workbench');
      // Target the workbench reader's page, not the board card's copy of the
      // PDF (the card's own selection handler is intentionally a no-op).
      await page.waitForSelector('.pdf-flow .pdf-page .textLayer span', { timeout: 15000 });
      const span = await page.$('.pdf-flow .pdf-page .textLayer span');
      const box = await span.boundingBox();
      await page.mouse.move(box.x + 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 6 });
      await page.mouse.up();
      // Right-click the selection: highlighting is an explicit choice, so the
      // palette appears only on the right-click, never on selection alone.
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
      await page.waitForSelector('.highlight-palette', { timeout: 5000 });
      await page.click('.highlight-palette button[aria-label="Highlight Yellow"]');
      await page.waitForSelector('.passage', { timeout: 5000 });
      annotationQuote = (await page.$eval('.passage p', (el) => el.textContent)).trim();
      await page.keyboard.press('Escape');
    });

    await test('Save As… via the file menu exports a .kelana download', async () => {
      await page.click('button[aria-label="File menu"]');
      await page.waitForSelector('.file-menu');
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        page.click('.file-menu .item-save-as'),
      ]);
      assert(
        download.suggestedFilename() === EXPORT_NAME,
        `unexpected filename: ${download.suggestedFilename()}`,
      );
      await download.saveAs(join(tmp, 'save-as.kelana'));
    });

    await test('Save via the menu silently produces a copy and names the file', async () => {
      await page.click('button[aria-label="File menu"]');
      await page.waitForSelector('.file-menu');
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        page.click('.file-menu .item-save'),
      ]);
      await download.saveAs(join(tmp, 'save-copy.kelana'));
      await page.waitForSelector('.toast', { timeout: 5000 });
      const toast = await page.$eval('.toast', (el) => el.textContent);
      assert(toast.includes('copy'), `Save did not explain the copy behavior: ${toast}`);
      const chip = await page.$eval('.save-state', (el) => el.textContent);
      assert(chip.includes(EXPORT_NAME), `chip does not show the file name: ${chip}`);
    });

    await test('Ctrl+S routes to Save As on the web', async () => {
      await page.keyboard.press('Control+s');
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        page.waitForTimeout(0),
      ]);
      await download.saveAs(join(tmp, 'ctrl-s.kelana'));
    });

    await test('the exported file verifies against better-sqlite3', async () => {
      const { problems, meta, doc, assetCount } = verifyKelanaFile(join(tmp, 'save-as.kelana'), {
        title: 'Thinking space',
        entityTypes: { pdf: 1, image: 1, annotation: 1, markdown: 5 },
        minAssets: 2,
        pdfTextIncludes: 'Kelana highlight test',
      });
      if (problems.length) throw new Error(problems.join('; '));
      assert(assetCount === 2, `expected exactly 2 assets, got ${assetCount}`);
      const annotation = Object.values(doc.entities).find((e) => e.type === 'annotation');
      assert(annotation, 'annotation entity missing from doc.json');
      assert(
        annotation.anchor?.pdfId && annotation.anchor.page === 1 && annotation.anchor.rects.length,
        'annotation anchor is incomplete',
      );
      assert(
        annotation.anchor.quote === annotationQuote,
        `annotation quote mismatch: ${JSON.stringify(annotation.anchor.quote)}`,
      );
      const pdfEntity = Object.values(doc.entities).find((e) => e.type === 'pdf');
      assert(
        pdfEntity?.assetId === `asset:${pdfChecksum}`,
        'pdf entity does not reference its asset by checksum id',
      );
      assert(
        meta.generator.startsWith('kelana 0.'),
        `generator missing app version: ${meta.generator}`,
      );
      const bytes = await readFile(join(tmp, 'save-as.kelana'));
      assert(bytes.length > 1000, 'export suspiciously small');
    });

    // --- Phase 2: open / import ---

    const openInFreshContext = async () => {
      const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const fresh = await context.newPage();
      fresh.on('pageerror', (e) => console.error('PAGE ERROR (fresh):', e.message));
      await fresh.goto(BASE, { waitUntil: 'networkidle' });
      await fresh.waitForSelector('.load-cover', { state: 'detached', timeout: 15000 });
      return { context, fresh };
    };
    const boardFileInput = (bytes, name = 'save-as.kelana') => [
      { name, mimeType: 'application/octet-stream', buffer: bytes },
    ];
    const readWorkingCopy = (target) =>
      target.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('kelana-local', 2);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const doc = await new Promise((resolve, reject) => {
          const request = db.transaction('documents').objectStore('documents').get('main');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        db.close();
        return doc;
      });

    await test('cancelling the confirm dialog leaves the board untouched', async () => {
      const { context, fresh } = await openInFreshContext();
      try {
        await fresh.setInputFiles(
          '.file-input',
          boardFileInput(await readFile(join(tmp, 'save-as.kelana'))),
        );
        await fresh.waitForSelector('.open-board-dialog', { timeout: 10000 });
        assert(
          (await fresh.$eval('.open-board-title', (el) => el.textContent)).includes(
            'save-as.kelana',
          ),
          'dialog does not name the file',
        );
        await fresh.click('.open-board-dialog button:has-text("Cancel")');
        await fresh.waitForSelector('.open-board-dialog', { state: 'detached' });
        const cards = await fresh.$$('.board-card');
        assert(cards.length === 5, `seed board should keep its 5 cards, got ${cards.length}`);
      } finally {
        await context.close();
      }
    });

    await test('a .kelana file mixed with other files is refused', async () => {
      const { context, fresh } = await openInFreshContext();
      try {
        await fresh.setInputFiles('.file-input', [
          ...boardFileInput(await readFile(join(tmp, 'save-as.kelana'))),
          { name: 'dot.png', mimeType: 'image/png', buffer: PNG },
        ]);
        await fresh.waitForSelector('.toast', { timeout: 10000 });
        const toast = await fresh.$eval('.toast', (el) => el.textContent);
        assert(toast.includes('opens by itself'), `unexpected toast: ${toast}`);
        const cards = await fresh.$$('.board-card');
        assert(cards.length === 5, `batch must be aborted, card count changed to ${cards.length}`);
      } finally {
        await context.close();
      }
    });

    await test('a file with a newer container version is refused, board untouched', async () => {
      const { default: Database } = await import('better-sqlite3');
      const db = new Database(await readFile(join(tmp, 'save-as.kelana')));
      db.pragma('user_version = 2');
      const bumped = db.serialize();
      db.close();
      const { context, fresh } = await openInFreshContext();
      try {
        await fresh.setInputFiles('.file-input', boardFileInput(bumped, 'future.kelana'));
        await fresh.waitForSelector('.open-board-dialog', { timeout: 10000 });
        await fresh.click('.open-board-dialog button:has-text("Open")');
        await fresh.waitForSelector('.toast', { timeout: 20000 });
        const toast = await fresh.$eval('.toast', (el) => el.textContent);
        assert(toast.includes('newer version'), `unexpected toast: ${toast}`);
        const cards = await fresh.$$('.board-card');
        assert(cards.length === 5, `refused import must not adopt the board, got ${cards.length}`);
      } finally {
        await context.close();
      }
    });

    await test('a fresh context opens the file: parity, highlights, cached search', async () => {
      const { context, fresh } = await openInFreshContext();
      try {
        const { doc: exported } = verifyKelanaFile(join(tmp, 'save-as.kelana'));
        await fresh.setInputFiles(
          '.file-input',
          boardFileInput(await readFile(join(tmp, 'save-as.kelana'))),
        );
        await fresh.waitForSelector('.open-board-dialog', { timeout: 10000 });
        await fresh.click('.open-board-dialog button:has-text("Open")');
        await fresh.waitForSelector('.toast', { timeout: 30000 });
        const toast = await fresh.$eval('.toast', (el) => el.textContent);
        assert(toast.includes('Opened Thinking space'), `unexpected toast: ${toast}`);

        // Identical entities, placements, and edges (working copy vs export).
        const working = await readWorkingCopy(fresh);
        assert(working.title === exported.title, 'board title mismatch');
        deepStrictEqual(
          Object.keys(working.entities).sort(),
          Object.keys(exported.entities).sort(),
          'entity ids differ',
        );
        for (const [id, entity] of Object.entries(exported.entities))
          deepStrictEqual(working.entities[id], entity, `entity ${id} differs after round-trip`);
        deepStrictEqual(working.placements, exported.placements, 'placements differ');
        deepStrictEqual(working.edges, exported.edges, 'edges differ');

        // Annotation highlights render in the reader.
        await fresh.click('.board-card[aria-label="sample.pdf"]', { button: 'right' });
        await fresh.click('text=Open in workbench');
        await fresh.waitForSelector('.pdf-flow .highlights span', { timeout: 15000 });
        const highlights = await fresh.$$('.pdf-flow .highlights span');
        assert(highlights.length > 0, 'no highlight rendered for the imported annotation');

        // Search hits the PDF text immediately — the pdf_text cache carried over.
        const indexedKeys = await fresh.evaluate(async () => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('kelana-local', 2);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const keys = await new Promise((resolve, reject) => {
            const request = db.transaction('search').objectStore('search').getAllKeys();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          db.close();
          return keys;
        });
        const pdfEntity = Object.values(exported.entities).find((e) => e.type === 'pdf');
        assert(
          indexedKeys.includes(pdfEntity.assetId),
          `pdf_text cache was not ingested for ${pdfEntity.assetId}`,
        );
        await fresh.keyboard.press('Control+k');
        await fresh.click('.search-box input');
        await fresh.keyboard.type('Kelana highlight');
        await fresh.waitForFunction(
          () =>
            [...document.querySelectorAll('.search-result')].some((el) =>
              el.textContent.includes('sample.pdf'),
            ),
          undefined,
          { timeout: 15000 },
        );
      } finally {
        await context.close();
      }
    });
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
