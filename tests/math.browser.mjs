/**
 * Browser behavior tests for KaTeX math in markdown cards. Run with:
 * node tests/math.browser.mjs
 *
 * Exercises the user-visible contract: typing `$...$` / `$$...$$` converts to
 * math, read-only cards render KaTeX, double-clicking (edit mode) shows the
 * raw LaTeX between delimiters, and currency text stays plain text.
 */
import { spawn } from 'node:child_process';
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

const CARD = '.board-card:not(.free-text):not(.pdf-card)';

const mathInfo = (page) =>
  page.evaluate((selector) => {
    const card = document.querySelector(selector);
    const inline = card.querySelector('.math-inline');
    const block = card.querySelector('.math-block');
    const host = inline ?? block;
    if (!host) return { present: false, text: card.textContent ?? '' };
    const source = host.querySelector('.math-source');
    const render = host.querySelector('.math-render');
    const style = (el) => (el ? getComputedStyle(el).display : 'absent');
    return {
      present: true,
      kind: inline ? 'inline' : 'block',
      editing: host.classList.contains('editing'),
      source: source?.textContent ?? '',
      sourceDisplay: style(source),
      katex: render?.querySelector('.katex') !== null && style(render) !== 'none',
      katexDisplay: render?.querySelector('.katex-display') !== null && style(render) !== 'none',
      renderDisplay: style(render),
      text: card.textContent ?? '',
    };
  }, CARD);

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

    const enterEdit = async () => {
      // Double-click the editable content itself — the card body may be much
      // larger than the content, and the card's scroll host swallows clicks.
      await page.dblclick(`${CARD} .editable`);
      await page.waitForTimeout(250);
    };
    const finishEdit = async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    };
    const replaceBody = async (text) => {
      await enterEdit();
      await page.keyboard.press('Control+a');
      await page.keyboard.type(text);
      await page.waitForTimeout(300);
    };

    await test('typing inline math shows the raw LaTeX between delimiters while editing', async () => {
      await replaceBody('Euler $e^{i\\pi}+1=0$ end');
      const m = await mathInfo(page);
      assert(m.present, 'math node was not created while typing');
      assert(m.kind === 'inline', `expected inline math, got ${m.kind}`);
      assert(m.editing, 'math node is not in editing state');
      assert(m.source === '$e^{i\\pi}+1=0$', `unexpected source: ${m.source}`);
      assert(m.sourceDisplay !== 'none', 'source is hidden while editing');
      assert(!m.katex, 'KaTeX should not render while editing');
    });

    await test('finishing the edit renders KaTeX and hides the syntax', async () => {
      await finishEdit();
      const m = await mathInfo(page);
      assert(m.present, 'math node disappeared after finishing');
      assert(!m.editing, 'math node still in editing state');
      assert(m.katex, 'KaTeX did not render');
      assert(m.renderDisplay !== 'none', 'rendered math is hidden');
      assert(m.sourceDisplay === 'none', 'raw source is visible in read-only mode');
      assert(m.text.includes('Euler') && m.text.includes('end'), `text lost: ${m.text}`);
    });

    await test('double-clicking the card shows the KaTeX syntax again', async () => {
      await enterEdit();
      const m = await mathInfo(page);
      assert(m.editing, 'double-click did not enter edit mode');
      assert(m.sourceDisplay !== 'none', 'source is hidden after double-click');
      assert(m.source === '$e^{i\\pi}+1=0$', `unexpected source: ${m.source}`);
      assert(!m.katex, 'KaTeX still rendered in edit mode');
      await finishEdit();
    });

    await test('block $$…$$ on its own line renders as display math', async () => {
      await replaceBody('$$\\frac{a}{b}\\cdot c$$');
      await finishEdit();
      const m = await mathInfo(page);
      assert(m.present && m.kind === 'block', `expected block math, got ${JSON.stringify(m)}`);
      assert(m.katexDisplay, 'display math did not render');
      assert(m.sourceDisplay === 'none', 'raw source is visible in read-only mode');
    });

    await test('currency text like $5 and $10 stays plain text', async () => {
      await replaceBody('between $5 and $10 items');
      await finishEdit();
      const m = await mathInfo(page);
      assert(!m.present, 'currency was converted to math');
      assert(m.text.includes('$5 and $10'), `currency text lost: ${m.text}`);
    });

    await test('math round-trips through markdown when opened in the workbench', async () => {
      await replaceBody('Euler $e^{i\\pi}+1=0$ end');
      await finishEdit();
      // Open the card in the workbench via its context menu — the workbench
      // re-parses the stored markdown from scratch (tokenizer path).
      await page.click(CARD, { button: 'right' });
      await page.waitForTimeout(300);
      await page.locator('.context-menu').getByText('Open in workbench').click();
      await page.waitForTimeout(500);
      const rendered = await page.$$eval('.math-render .katex', (els) => els.length);
      assert(rendered >= 2, `expected board + workbench KaTeX renders, got ${rendered}`);
      const benchSource = await page.$eval(
        '.workbench .math-inline .math-source',
        (el) => el.textContent,
      );
      assert(benchSource === '$e^{i\\pi}+1=0$', `workbench source mangled: ${benchSource}`);
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
