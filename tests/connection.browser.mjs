/**
 * Browser behavior tests for connections: selecting/deleting an edge
 * independently, and annotation cards not auto-connecting to their PDF.
 * Run with: node tests/connection.browser.mjs
 *
 * Uses the system Chrome; no browser downloads.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = 5199;
const BASE = `http://localhost:${PORT}/`;

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

/** Minimal one-page PDF with a line of extractable text. */
function buildPdf(text) {
  const objects = [];
  objects[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  objects[2] = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  objects[3] =
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R '
    + '/Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n';
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET\n`;
  objects[4] = `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`;
  objects[5] = '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length;
    pdf += objects[i];
  }
  const xref = pdf.length;
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** Screen-space midpoint of the first connection hit path. */
const edgeMidpoint = (page) =>
  page.$eval('svg.edges path.connection-hit', (el) => {
    const p = el.getPointAtLength(el.getTotalLength() / 2);
    const m = el.getScreenCTM();
    return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
  });

const count = (page, selector) => page.$$eval(selector, (els) => els.length);

const run = async () => {
  const server = await startDevServer();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    await test('clicking a connection selects it', async () => {
      const point = await edgeMidpoint(page);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(200);
      const selected = await count(page, 'svg.edges path.connection.selected');
      assert(selected === 1, `expected 1 selected connection, got ${selected}`);
    });

    await test('right-clicking a connection offers delete; deleting keeps both cards', async () => {
      const cardsBefore = await count(page, '.board-card');
      const edgesBefore = await count(page, 'svg.edges path.connection');
      const point = await edgeMidpoint(page);
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await page.waitForTimeout(300);
      const item = await page.$('div.floating-menu button:has-text("Delete connection")');
      assert(item, 'edge context menu did not appear');
      await item.click();
      await page.waitForTimeout(300);
      const edgesAfter = await count(page, 'svg.edges path.connection');
      const cardsAfter = await count(page, '.board-card');
      assert(
        edgesAfter === edgesBefore - 1,
        `expected ${edgesBefore - 1} edges after delete, got ${edgesAfter}`,
      );
      assert(cardsAfter === cardsBefore, `cards were affected: ${cardsBefore} -> ${cardsAfter}`);
      assert(!(await page.$('div.floating-menu')), 'menu stayed open after delete');
    });

    await test('deleting a connection is undoable', async () => {
      const edgesBefore = await count(page, 'svg.edges path.connection');
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(300);
      const edgesAfter = await count(page, 'svg.edges path.connection');
      assert(edgesAfter === edgesBefore + 1, `undo did not restore the edge (${edgesAfter})`);
      // Drop it again so the next test starts without the seed edge.
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(300);
    });

    await test('placing a PDF highlight on the board creates no connection', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'kelana-test-'));
      const pdfPath = join(dir, 'sample.pdf');
      await writeFile(pdfPath, buildPdf('Kelana annotation test passage'));
      const edgesBefore = await count(page, 'svg.edges path.connection');

      await page.setInputFiles('input[type="file"]', pdfPath);
      await page.waitForSelector('.board-card[data-entity^="pdf:"]', { timeout: 15000 });
      await page.click('.board-card[data-entity^="pdf:"] button[title="Open in workbench"]');
      // Target the workbench reader's page: the board card also renders a
      // PdfPage now, but its selection handler is intentionally a no-op.
      await page.waitForSelector('.pdf-flow .textLayer span', { timeout: 20000 });
      // Synthesize a text selection over the reader's first text-layer span,
      // then fire the pointerup that PdfPage listens on.
      await page.evaluate(() => {
        const span = document.querySelector('.pdf-flow .textLayer span');
        const range = document.createRange();
        range.selectNodeContents(span);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document
          .querySelector('.pdf-flow .pdf-page')
          .dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      });
      await page.waitForSelector('.selection-popover', { timeout: 5000 });
      await page.click('.selection-popover button:has-text("Keep highlight")');
      await page.waitForTimeout(300);
      await page.click('.selection-popover button:has-text("Place on board")');
      await page.waitForTimeout(500);

      const annotationCard = await count(page, '.board-card[data-entity^="annotation:"]');
      assert(annotationCard === 1, `expected 1 annotation card on the board, got ${annotationCard}`);
      const edgesAfter = await count(page, 'svg.edges path.connection');
      assert(
        edgesAfter === edgesBefore,
        `highlight placement changed edge count: ${edgesBefore} -> ${edgesAfter}`,
      );
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
