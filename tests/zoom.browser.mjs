/**
 * Browser behavior tests for board zoom: wheel and trackpad-pinch gestures.
 * Run with: node tests/zoom.browser.mjs
 *
 * Uses the system Chrome; no browser downloads. Own port (5197) and process
 * group, so it neither collides with nor leaks into the other suites.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 5197;
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

/** The camera as the rendered scene transform: translate + scale. */
const camera = (page) =>
  page.evaluate(() => {
    const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.scene')).transform);
    return { x: m.e, y: m.f, zoom: m.a };
  });

/**
 * Dispatch one trusted-shape wheel event at a screen point. ctrlKey is what a
 * trackpad pinch looks like in the DOM; the deltas are the real encoding
 * (Chromium: deltaY = -100·ln(scale), so -3 ≈ a 3% pinch step).
 */
const wheel = (page, { x, y, deltaY, ctrl = false, deltaMode = 0 }) =>
  page.evaluate(
    ({ x, y, deltaY, ctrl, deltaMode }) => {
      // Hit-test like a real wheel event so card scroll hosts receive it.
      const target = document.elementFromPoint(x, y) ?? document.querySelector('.board');
      target.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY,
          deltaMode,
          ctrlKey: ctrl,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { x, y, deltaY, ctrl, deltaMode },
  );

/** One gesture, then wait for the eased camera to settle. */
async function wheelBurst(page, options, times = 1, gap = 20) {
  for (let i = 0; i < times; i++) {
    await wheel(page, options);
    if (gap) await page.waitForTimeout(gap);
  }
  await page.waitForTimeout(500);
}

const setNavigationMode = async (page, mode) => {
  await page.click(`.navigation-controls button[aria-label="Use ${mode} navigation"]`);
  await page.waitForTimeout(150);
};

const resetZoom = async (page) => {
  await page.click('.zoom-value');
  await page.waitForTimeout(200);
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
    await page.waitForTimeout(800);

    await test('two-finger scroll pans and leaves the zoom alone', async () => {
      const before = await camera(page);
      await wheelBurst(page, { x: 700, y: 450, deltaY: -120 }, 3, 30);
      const after = await camera(page);
      assert(after.zoom === before.zoom, `zoom changed to ${after.zoom}`);
      assert(after.y !== before.y, 'board did not pan');
    });

    await test('a pinch follows the fingers instead of crawling', async () => {
      await resetZoom(page);
      const before = await camera(page);
      // Ten 3% pinch steps = exp(0.3) ≈ 1.35x, the exact finger scale.
      await wheelBurst(page, { x: 900, y: 300, deltaY: -3, ctrl: true }, 10, 8);
      const after = await camera(page);
      const ratio = after.zoom / before.zoom;
      assert(
        Math.abs(ratio - Math.exp(0.3)) < 0.02,
        `pinch zoomed ${ratio.toFixed(3)}x, expected ${Math.exp(0.3).toFixed(3)}x`,
      );
    });

    await test('a pinch keeps the board point under the pointer fixed', async () => {
      await resetZoom(page);
      const anchor = { x: 1000, y: 250 };
      const world = (c) => ({ x: (anchor.x - c.x) / c.zoom, y: (anchor.y - c.y) / c.zoom });
      const before = world(await camera(page));
      await wheelBurst(page, { x: anchor.x, y: anchor.y, deltaY: -3, ctrl: true }, 20, 8);
      const after = world(await camera(page));
      assert(Math.abs(after.x - before.x) < 0.5, `anchor drifted ${after.x - before.x}px in x`);
      assert(Math.abs(after.y - before.y) < 0.5, `anchor drifted ${after.y - before.y}px in y`);
    });

    await test('mouse mode: one wheel notch is one 1.2x step', async () => {
      await setNavigationMode(page, 'mouse');
      await resetZoom(page);
      const before = await camera(page);
      await wheelBurst(page, { x: 700, y: 450, deltaY: -100 });
      const after = await camera(page);
      assert(
        Math.abs(after.zoom / before.zoom - 1.2) < 0.01,
        `one notch zoomed ${(after.zoom / before.zoom).toFixed(3)}x, expected 1.2x`,
      );
    });

    await test('mouse mode: the notch is eased, not applied in one frame', async () => {
      await resetZoom(page);
      const before = await camera(page);
      const samples = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const zoom = () =>
              new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.scene')).transform).a;
            const target = document.elementFromPoint(700, 450) ?? document.querySelector('.board');
            target.dispatchEvent(
              new WheelEvent('wheel', {
                deltaY: -100,
                clientX: 700,
                clientY: 450,
                bubbles: true,
                cancelable: true,
              }),
            );
            const values = [];
            const start = performance.now();
            const tick = () => {
              values.push(zoom());
              if (performance.now() - start < 260) requestAnimationFrame(tick);
              else resolve(values);
            };
            requestAnimationFrame(tick);
          }),
      );
      const distinct = new Set(samples.map((z) => z.toFixed(4)));
      assert(
        distinct.size > 5,
        `zoom moved in ${distinct.size} frame(s): ${[...distinct].join(', ')}`,
      );
      const after = await camera(page);
      assert(after.zoom > before.zoom, 'zoom never moved');
    });

    await test('mouse mode: a line-mode wheel still zooms', async () => {
      await resetZoom(page);
      const before = await camera(page);
      // Firefox reports mouse notches as lines (3 lines ≈ half a notch).
      await wheelBurst(page, { x: 700, y: 450, deltaY: -3, deltaMode: 1 });
      const after = await camera(page);
      assert(after.zoom > before.zoom * 1.02, `line-mode wheel zoomed to ${after.zoom}`);
    });

    await test('zoom clamps at the maximum instead of overshooting', async () => {
      await resetZoom(page);
      await wheelBurst(page, { x: 700, y: 450, deltaY: -100 }, 20, 10);
      const after = await camera(page);
      assert(after.zoom === 2.5, `zoom settled at ${after.zoom}, expected the 2.5 maximum`);
    });

    await test('wheel over a selected card scrolls the card, not the camera', async () => {
      await page.keyboard.press('0');
      await page.waitForTimeout(300);
      await resetZoom(page);
      const card = page.locator('.board-card').first();
      await card.click();
      await page.waitForTimeout(150);
      const box = await card.boundingBox();
      const before = await camera(page);
      await wheelBurst(page, { x: box.x + box.width / 2, y: box.y + 20, deltaY: 100 }, 3, 40);
      const after = await camera(page);
      assert(after.zoom === before.zoom, `camera zoomed to ${after.zoom}`);
    });
  } finally {
    await browser.close();
    stopDevServer(server);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

run();
