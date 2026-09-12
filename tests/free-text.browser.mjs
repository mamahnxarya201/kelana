/**
 * Browser behavior tests. Run with: npm run test:browser
 *
 * These exercise real user behavior (adding text, typing, resizing) in a real
 * Chromium layout engine — the free-text sizing engine measures the DOM, so it
 * cannot be tested in node. Uses the system Chrome; no browser downloads.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 5198;
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

const cardInfo = (page) =>
  page.evaluate(() => {
    const card = document.querySelector('.board-card.free-text');
    if (!card) return null;
    const host = card.querySelector('.live-editor');
    return {
      width: card.offsetWidth,
      height: card.offsetHeight,
      contentWidth: host.scrollWidth,
      contentHeight: host.scrollHeight,
      lines: Math.round((host.scrollHeight - 6) / (18 * 1.35)),
      text: card.querySelector('.ProseMirror')?.textContent ?? '',
    };
  });

const dragHandle = async (page, selector, dx, dy) => {
  const handle = await page.$(selector);
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
};

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

    const addFreeText = async () => {
      await page.click('button[title="Free text · T"]');
      await page.waitForTimeout(400);
    };
    const finishEdit = async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    };

    await test('new free text hugs its content on a single line', async () => {
      await addFreeText();
      const c = await cardInfo(page);
      assert(c, 'free text card exists');
      assert(c.text === 'New Text', `unexpected content: ${c.text}`);
      assert(c.lines === 1, `expected 1 line, got ${c.lines} (h=${c.height})`);
      assert(c.height <= 34, `box taller than one line: ${c.height}`);
    });

    await test('typing grows the box and keeps it hugging the text', async () => {
      await page.keyboard.type(' one two three four five six seven');
      await page.waitForTimeout(300);
      const c = await cardInfo(page);
      assert(c.lines === 1, `expected 1 line after typing, got ${c.lines}`);
      assert(c.width > 230, `box did not grow with text: ${c.width}`);
      assert(c.height <= 34, `box taller than one line after typing: ${c.height}`);
    });

    await test('escape finishes editing; rendered content keeps the box fitted', async () => {
      await finishEdit();
      const c = await cardInfo(page);
      assert(c, 'card still present after finishing edit');
      assert(c.lines === 1, `expected 1 line after finish, got ${c.lines}`);
    });

    await test('dragging width narrower locks width and grows height (text wraps)', async () => {
      await dragHandle(page, '.board-card.free-text .card-resize-zone.e', -120, 0);
      const c = await cardInfo(page);
      assert(c.lines >= 2, `expected wrapped lines, got ${c.lines}`);
      assert(c.height > 40, `height did not grow to fit wrapped text: ${c.height}`);
      assert(c.width >= 150 && c.width <= 200, `width not near the dragged size: ${c.width}`);
    });

    await test('dragging height smaller locks height and grows width (text fits)', async () => {
      const before = await cardInfo(page);
      await dragHandle(page, '.board-card.free-text .card-resize-zone.s', 0, -8);
      const c = await cardInfo(page);
      assert(c.width >= before.width, `width should grow when height shrinks: ${c.width} < ${before.width}`);
      assert(c.lines <= before.lines, `content should need fewer/equal lines, got ${c.lines}`);
    });

    await test('height cannot grow beyond the text natural height', async () => {
      await dragHandle(page, '.board-card.free-text .card-resize-zone.s', 0, 200);
      const c = await cardInfo(page);
      assert(c.height <= 40, `height escaped the natural clamp: ${c.height}`);
      assert(c.lines === 1, `expected single line after clamp, got ${c.lines}`);
    });

    await test('markdown heading renders larger and the box grows to fit it', async () => {
      await page.dblclick('.board-card.free-text');
      await page.waitForTimeout(200);
      await page.keyboard.press('Control+a');
      await page.keyboard.type('# Big title');
      await finishEdit();
      const c = await cardInfo(page);
      const h = await page.$eval('.board-card.free-text h1', (el) => el.offsetHeight);
      assert(h > 20, `heading not rendered as heading (h=${h})`);
      // The notes editor's live markdown syntax leaves an empty trailing
      // paragraph after a heading; the box fits the rendered content (<= 2 blocks).
      assert(c.height <= 105, `heading box did not fit its content: ${c.height}`);
    });

    await test('moving the card keeps its size', async () => {
      const before = await cardInfo(page);
      const card = await page.$('.board-card.free-text');
      const box = await card.boundingBox();
      await page.mouse.move(box.x + 40, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + 140, box.y + 80, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const after = await cardInfo(page);
      assert(after.width === before.width && after.height === before.height, 'size changed while moving');
    });

    await test('dragging a connection between two cards creates an edge', async () => {
      // Park the free-text card away from the center so the new card has room.
      const card = await page.$('.board-card.free-text');
      const box = await card.boundingBox();
      await page.mouse.move(box.x + 40, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x - 320, box.y - 200, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      // Add a second card at the center with the N key, then leave edit mode.
      // (The workspace starts with seeded cards, so counts are deltas.)
      await page.keyboard.press('n');
      await page.waitForTimeout(400);
      await page.keyboard.press('Escape');
      await page.mouse.click(60, 60);
      await page.waitForTimeout(200);
      // Enter connect mode and drag from the free-text card's right port.
      await page.keyboard.press('c');
      await page.waitForTimeout(200);
      const edgesBefore = await page.$$eval('svg.edges path.connection', (els) => els.length);
      const entityId = await page.$eval('.board-card.free-text', (el) => el.dataset.entity);
      const source = await page.$(
        `.connection-port[data-entity="${entityId}"][data-side="right"]`,
      );
      assert(source, 'connection port rendered on the free-text card');
      const sbox = await source.boundingBox();
      const others = await page.$$('.board-card:not(.free-text)');
      assert(others.length >= 1, 'no target card available');
      const tbox = await others[0].boundingBox();
      await page.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2);
      await page.mouse.down();
      await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      const edges = await page.$$eval('svg.edges path.connection', (els) => els.length);
      assert(edges === edgesBefore + 1, `expected ${edgesBefore + 1} edges after connection drag, got ${edges}`);
      await page.keyboard.press('v');
      await page.waitForTimeout(200);
    });

    await test('marquee-selecting two cards and creating a group works', async () => {
      // Marquee select both cards on the empty background.
      await page.mouse.move(60, 60);
      await page.mouse.down();
      await page.mouse.move(1340, 760, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      // Right-click to open the multi-selection menu.
      await page.mouse.click(1340, 760, { button: 'right' });
      await page.waitForTimeout(300);
      const item = await page.$('div.floating-menu button');
      assert(item, 'selection menu did not appear');
      const label = await item.textContent();
      const selectedCount = await page.evaluate(
        () => document.querySelectorAll('.board-card.selected').length,
      );
      assert(
        label.includes(`Create group from ${selectedCount} items`),
        `unexpected menu item: ${label} (selected: ${selectedCount})`,
      );
      await item.click();
      await page.waitForTimeout(300);
      const group = await page.$eval('.group-box', (el) => ({
        label: el.querySelector('.group-label')?.value ?? el.getAttribute('aria-label'),
      }));
      assert(group.label === 'New group', `unexpected group label: ${group.label}`);
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
