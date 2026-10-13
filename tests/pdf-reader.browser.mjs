/**
 * Browser behavior tests for the workbench PDF reader: the two view modes,
 * gesture zoom/pan, and selection + highlight geometry while zoomed.
 * Run with: node tests/pdf-reader.browser.mjs
 *
 * Uses the system Chrome; no browser downloads. Own port (5196) and process
 * group, so it neither collides with nor leaks into the other suites.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = 5196;
const BASE = `http://localhost:${PORT}/`;

function startDevServer() {
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
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

function stopDevServer(child) {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill();
  }
}

/** A three-page PDF with real selectable text, built without dependencies. */
function writeFixture() {
  const lines = [
    'Kelana reading probe',
    '',
    'Alpha beta gamma delta epsilon zeta eta theta.',
    'Iota kappa lambda mu nu xi omicron pi rho sigma.',
    'Tau upsilon phi chi psi omega, then numbers:',
    '0123456789 — the quick brown fox jumps over the lazy dog.',
    'Pack my box with five dozen liquor jugs. Sphinx of',
    'black quartz, judge my vow. How vexingly quick',
    'daft zebras jump! Bright vixens jump; dozy fowl',
    'quack. Then the last line settles the paragraph.',
  ];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>'];
  const pageIds = [3, 5, 7];
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count 3 >>`);
  for (let i = 0; i < 3; i++) {
    const stream = lines
      .map((line, row) => {
        const text = row === 0 ? `${line} — page ${i + 1}` : line;
        const size = row === 0 ? 20 : 13;
        return `BT /F1 ${size} Tf 72 ${740 - row * 26} Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
      })
      .join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++)
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const path = join(mkdtempSync(join(tmpdir(), 'kelana-reader-')), 'probe.pdf');
  writeFileSync(path, pdf, 'latin1');
  return path;
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

const run = async () => {
  const fixture = writeFixture();
  const server = await startDevServer();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
    page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
    const cdp = await page.context().newCDPSession(page);

    /** Wheel through CDP, the only way a ctrl+wheel pinch can be held. */
    async function wheel(x, y, { deltaY, ctrl = false, times = 1, gap = 10 }) {
      for (let i = 0; i < times; i++) {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x,
          y,
          deltaX: 0,
          deltaY,
          modifiers: ctrl ? 2 : 0,
          pointerType: 'mouse',
        });
        if (gap) await page.waitForTimeout(gap);
      }
      await page.waitForTimeout(600);
    }

    /** Click by coordinates: an element click scrolls the sticky header into
     *  view, which would move the reading position out from under the test. */
    async function tap(selector) {
      const box = await page.locator(selector).first().boundingBox();
      if (!box) throw new Error(`no box for ${selector}`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(250);
    }

    const reader = () =>
      page.evaluate(() => {
        const root = document.querySelector('.pdf-reader');
        const pageEl = root?.querySelector('.pdf-page');
        const stage = root?.querySelector('.pdf-stage');
        const host = document.querySelector('.bench-column');
        return {
          mode: stage ? 'page' : 'all',
          pageRect: pageEl?.getBoundingClientRect().toJSON() ?? null,
          stageRect: stage?.getBoundingClientRect().toJSON() ?? null,
          flowTransform: root?.querySelector('.pdf-flow')?.style.transform ?? null,
          stageTransform: root?.querySelector('.pdf-stage-page')?.style.transform ?? null,
          canvasWidth: pageEl?.querySelector('canvas')?.width ?? null,
          pageNumber: pageEl?.dataset.page ?? null,
          pageCount: root?.querySelectorAll('.pdf-page').length ?? 0,
          scrollTop: host?.scrollTop ?? null,
          chip:
            document.querySelector('.item-actions button[title="Reset zoom to fit"]')?.textContent ??
            null,
          trigger: document.querySelector('.item-actions .zoom-button span')?.textContent ?? null,
          bar: root?.querySelector('.pdf-flip-count')?.textContent ?? null,
        };
      });

    /** A point inside the reader's visible surface. */
    const readerPoint = () =>
      page.evaluate(() => {
        const host = document.querySelector('.bench-column').getBoundingClientRect();
        const root = document.querySelector('.pdf-reader').getBoundingClientRect();
        return {
          x: Math.round(Math.max(host.left, root.left) + 140),
          y: Math.round(Math.max(host.top, root.top) + 160),
        };
      });

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.setInputFiles('input[type=file]', fixture);
    await page.waitForSelector('.board-card.pdf-card', { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.hover('.board-card.pdf-card');
    await page.click('.pdf-card-open');
    await page.waitForSelector('.pdf-reader .pdf-page .textLayer span', { timeout: 15000 });
    await page.waitForTimeout(1200);

    await test('opens the PDF as a reading flow', async () => {
      const state = await reader();
      assert(state.mode === 'all', `view mode is ${state.mode}`);
      assert(state.pageCount === 3, `${state.pageCount} pages rendered`);
      assert(state.trigger === 'All pages', `view menu reads ${state.trigger}`);
      assert(state.chip === null, 'a reset chip shows at fit');
    });

    await test('a pinch zooms about the pointer and sharpens the raster', async () => {
      const before = await reader();
      const point = await readerPoint();
      const fraction = () =>
        page.evaluate(
          ({ x, y }) => {
            const r = document.elementFromPoint(x, y).closest('.pdf-page').getBoundingClientRect();
            return { fx: (x - r.left) / r.width, fy: (y - r.top) / r.height };
          },
          point,
        );
      const anchorBefore = await fraction();
      await wheel(point.x, point.y, { deltaY: -3, ctrl: true, times: 24, gap: 8 });
      const after = await reader();
      const anchorAfter = await fraction();
      assert(
        after.pageRect.width > before.pageRect.width * 1.5,
        `page width ${Math.round(before.pageRect.width)} → ${Math.round(after.pageRect.width)}`,
      );
      assert(
        Math.abs(anchorAfter.fy - anchorBefore.fy) < 0.02 &&
          Math.abs(anchorAfter.fx - anchorBefore.fx) < 0.02,
        `anchor drifted to ${anchorAfter.fy.toFixed(3)}/${anchorAfter.fx.toFixed(3)}`,
      );
      assert(
        after.canvasWidth > before.canvasWidth,
        `raster stayed at ${after.canvasWidth}px`,
      );
      assert(after.chip !== null, 'no zoom readout in the header');
    });

    await test('middle-drag pans the page and drags the reading column', async () => {
      const before = await reader();
      const point = await readerPoint();
      await page.mouse.move(point.x, point.y);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(point.x - 90, point.y + 40, { steps: 10 });
      await page.mouse.up({ button: 'middle' });
      await page.waitForTimeout(400);
      const after = await reader();
      assert(
        after.flowTransform !== before.flowTransform,
        `page transform unchanged (${after.flowTransform})`,
      );
      assert(
        after.scrollTop === before.scrollTop - 40,
        `column scrolled ${before.scrollTop} → ${after.scrollTop}`,
      );
    });

    await test('the reset chip returns the page to fit', async () => {
      await tap('.item-actions button[title="Reset zoom to fit"]');
      await page.waitForTimeout(500);
      const state = await reader();
      assert(state.chip === null, `chip still reads ${state.chip}`);
      assert(state.flowTransform === 'translateX(0px)', `page sits at ${state.flowTransform}`);
    });

    await test('a selection at zoom keeps its geometry', async () => {
      const point = await readerPoint();
      await wheel(point.x, point.y, { deltaY: -3, ctrl: true, times: 24, gap: 8 });
      const line = await page.evaluate(() => {
        const host = document.querySelector('.bench-column').getBoundingClientRect();
        // A zoomed page is panned, and the flow clips it: only the part inside
        // both boxes can be hit, so the drag has to stay in that overlap.
        const flow = document.querySelector('.pdf-flow').getBoundingClientRect();
        const spans = [...document.querySelectorAll('.pdf-flow .pdf-page .textLayer span')].filter(
          (s) => s.textContent.trim().length > 20,
        );
        for (const span of spans) {
          const r = span.getBoundingClientRect();
          const left = Math.max(r.left, host.left + 20, flow.left + 4);
          const right = Math.min(r.right, host.right - 20, flow.right - 4);
          const y = r.top + r.height / 2;
          if (right - left < 140 || y < host.top + 70 || y > host.bottom - 70) continue;
          if (document.elementFromPoint(left + 10, y)?.closest('.textLayer'))
            return { left, right, y };
        }
        return null;
      });
      assert(line, 'no selectable line on screen at zoom');

      await page.mouse.move(line.left + 6, line.y);
      await page.mouse.down();
      await page.mouse.move(line.left + 70, line.y, { steps: 8 });
      await page.mouse.move(line.left + 130, line.y, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const selection = await page.evaluate(() => {
        const sel = window.getSelection();
        const range = sel.rangeCount ? sel.getRangeAt(0) : null;
        const r = range?.getBoundingClientRect();
        return { text: sel.toString(), rect: r ? { x: r.left, y: r.top, width: r.width } : null };
      });
      assert(selection.text.length > 5, `selection is ${JSON.stringify(selection.text)}`);

      await page.mouse.click(line.left + 130, line.y, { button: 'right' });
      await page.waitForTimeout(300);
      const palette = await page.evaluate(() => {
        const el = document.querySelector('.highlight-palette');
        const swatch = el?.querySelector('.palette-swatch');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { height: r.height, y: r.top, swatch: swatch?.getBoundingClientRect().width };
      });
      assert(palette, 'right-click on a selection did not open the palette');
      assert(
        Math.abs(palette.height - 64) < 6 && Math.abs(palette.swatch - 22) < 2,
        `palette scaled with the page: ${Math.round(palette.height)}px tall, swatch ${palette.swatch}px`,
      );
      assert(
        Math.abs(palette.y - (line.y + 14)) < 8,
        `palette sits at y ${Math.round(palette.y)}, click at ${Math.round(line.y)}`,
      );

      await tap('.highlight-palette .palette-swatch:nth-child(2)');
      await page.waitForTimeout(400);
      const highlight = await page.evaluate(() => {
        const span = document.querySelector('.pdf-flow .pdf-page .highlights span');
        if (!span) return null;
        const r = span.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width };
      });
      assert(highlight, 'no highlight rendered');
      assert(
        Math.abs(highlight.x - selection.rect.x) < 12 &&
          Math.abs(highlight.y - selection.rect.y) < 12 &&
          highlight.width > selection.rect.width * 0.6,
        `highlight at ${Math.round(highlight.x)}/${Math.round(highlight.y)} vs selection ${Math.round(selection.rect.x)}/${Math.round(selection.rect.y)}`,
      );
    });

    await test('the per-page view shows one fitted page with a page bar', async () => {
      await tap('.item-actions button[title="Reset zoom to fit"]');
      await page.waitForTimeout(500);
      await tap('.item-actions .zoom-button[aria-label^="PDF view"]');
      await tap('.file-menu-item:has-text("Per page")');
      await page.waitForTimeout(900);
      const state = await reader();
      assert(state.mode === 'page', `view mode is ${state.mode}`);
      assert(state.pageCount === 1, `${state.pageCount} pages rendered`);
      assert(state.bar === '1 / 3', `page bar reads ${state.bar}`);
      assert(
        state.pageRect.height <= state.stageRect.height + 1,
        `page ${Math.round(state.pageRect.height)}px taller than its stage ${Math.round(state.stageRect.height)}px`,
      );
      assert(
        Math.abs(
          state.pageRect.y +
            state.pageRect.height / 2 -
            (state.stageRect.y + state.stageRect.height / 2),
        ) < 2,
        'page is not centred in the stage',
      );
    });

    await test('the page bar flips pages', async () => {
      await page.click('.pdf-reader .pdf-flip-button[aria-label="Next page"]');
      await page.waitForTimeout(700);
      const second = await reader();
      assert(second.bar === '2 / 3' && second.pageNumber === '2', `bar ${second.bar}, page ${second.pageNumber}`);
      await page.click('.pdf-reader .pdf-flip-button[aria-label="Next page"]');
      await page.waitForTimeout(700);
      const third = await reader();
      assert(third.bar === '3 / 3', `bar ${third.bar}`);
      assert(
        await page.locator('.pdf-reader .pdf-flip-button[aria-label="Next page"]').isDisabled(),
        'next page stays enabled on the last page',
      );
    });

    await test('a pinch and a drag work inside the page view', async () => {
      const before = await reader();
      const point = await readerPoint();
      await wheel(point.x, point.y, { deltaY: -3, ctrl: true, times: 20, gap: 8 });
      const zoomed = await reader();
      assert(
        zoomed.pageRect.width > before.pageRect.width * 1.4,
        `page width ${Math.round(before.pageRect.width)} → ${Math.round(zoomed.pageRect.width)}`,
      );
      assert(zoomed.chip !== null, 'no zoom readout in the header');
      await page.mouse.move(point.x, point.y);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(point.x - 70, point.y - 50, { steps: 10 });
      await page.mouse.up({ button: 'middle' });
      await page.waitForTimeout(300);
      const panned = await reader();
      assert(
        panned.stageTransform !== zoomed.stageTransform,
        `page transform unchanged (${panned.stageTransform})`,
      );
    });

    await test('switching back to the flow returns to the page just read', async () => {
      await tap('.item-actions .zoom-button[aria-label^="PDF view"]');
      await tap('.file-menu-item:has-text("All pages")');
      await page.waitForTimeout(900);
      const state = await reader();
      assert(state.mode === 'all' && state.pageCount === 3, `mode ${state.mode}, ${state.pageCount} pages`);
      const offset = await page.evaluate(() => {
        const host = document.querySelector('.bench-column');
        const target = document.querySelector('.pdf-flow .pdf-page[data-page="3"]');
        return target.getBoundingClientRect().top - host.getBoundingClientRect().top;
      });
      assert(offset > -40 && offset < 260, `page 3 sits ${Math.round(offset)}px into the column`);
    });

    await test('touchpad wheel keeps reading; mouse mode zooms', async () => {
      const before = await reader();
      const point = await readerPoint();
      await page.mouse.move(point.x, point.y);
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(400);
      const scrolled = await reader();
      assert(
        scrolled.scrollTop < before.scrollTop &&
          scrolled.pageRect.width === before.pageRect.width,
        `wheel changed the view: scrollTop ${before.scrollTop} → ${scrolled.scrollTop}, page ${Math.round(before.pageRect.width)} → ${Math.round(scrolled.pageRect.width)}`,
      );

      await tap('.navigation-controls button[aria-label="Use mouse navigation"]');
      await wheel(point.x, point.y, { deltaY: -100 });
      const zoomed = await reader();
      assert(
        zoomed.chip !== null && zoomed.pageRect.width > scrolled.pageRect.width * 1.15,
        `one notch did not zoom: chip ${zoomed.chip}, width ${Math.round(zoomed.pageRect.width)}`,
      );
      await tap('.navigation-controls button[aria-label="Use touchpad navigation"]');
    });

    await test('the reader view is saved with the pane', async () => {
      const point = await readerPoint();
      await wheel(point.x, point.y, { deltaY: -3, ctrl: true, times: 12, gap: 8 });
      await page.waitForTimeout(700);
      const saved = await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const open = indexedDB.open('kelana-local', 2);
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        const value = await new Promise((resolve, reject) => {
          const request = db
            .transaction('documents', 'readonly')
            .objectStore('documents')
            .get('main');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        db.close();
        return value?.panes?.[0] ?? null;
      });
      assert(saved, 'no pane in the saved document');
      assert(
        saved.mode === 'all' && saved.zoom > 1 && saved.pan,
        `saved pane is ${JSON.stringify({ mode: saved.mode, zoom: saved.zoom, pan: saved.pan })}`,
      );
    });
  } finally {
    await browser.close();
    stopDevServer(server);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

run();
