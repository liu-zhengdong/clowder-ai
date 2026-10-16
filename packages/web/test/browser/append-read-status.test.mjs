import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from '../../../ppt-forge/node_modules/playwright/index.mjs';

test(
  'real Append region shows optional exact read status with keyboard, hover and mobile tap',
  { timeout: 60000 },
  async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const require = createRequire(path.join(root, 'package.json'));
    const tailwind = require('tailwindcss');
    const config = require(path.join(root, 'tailwind.config.js'));
    const origin = 'https://append-read.test';
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      esbuild: { jsx: 'automatic' },
      resolve: { alias: { '@': path.join(root, 'src') } },
      define: { 'process.env.NEXT_PUBLIC_API_URL': JSON.stringify(origin) },
      css: {
        postcss: {
          plugins: [
            tailwind({
              ...config,
              content: [
                path.join(root, 'src/**/*.{ts,tsx}'),
                path.join(root, 'test/browser/fixtures/append-read-status.tsx'),
              ],
            }),
          ],
        },
      },
      build: {
        write: false,
        minify: false,
        rollupOptions: {
          input: path.join(root, 'test/browser/fixtures/append-read-status.tsx'),
          output: { format: 'es', inlineDynamicImports: true },
        },
      },
    });
    const output = result.output;
    const bundle = output.find((item) => item.type === 'chunk' && item.isEntry);
    const css = output
      .filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
      .map((item) => item.source)
      .join('\n');
    assert.match(css, /@keyframes pulse/, 'test must load the real Tailwind animation');
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
    });
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        assert.equal(url.origin, origin);
        assert.equal(route.request().method(), 'GET');
        const body =
          url.pathname === '/proof.js'
            ? bundle.code
            : url.pathname === '/proof.css'
              ? css
              : url.pathname.startsWith('/api/')
                ? JSON.stringify({ ok: true, name: 'lang', cats: [] })
                : '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/proof.css"><div id="root"></div><script type="module" src="/proof.js"></script>';
        await route.fulfill({
          body,
          contentType: url.pathname.endsWith('.js')
            ? 'text/javascript'
            : url.pathname.endsWith('.css')
              ? 'text/css'
              : url.pathname.startsWith('/api/')
                ? 'application/json'
                : 'text/html',
        });
      });
      await page.goto(origin);
      await page.locator('main[data-ready="true"]').waitFor();
      const supported = page.locator('[data-appended-input-id="supported"] button[data-append-delivery-state]');
      const unsupported = page.locator('[data-appended-input-id="unsupported"] button[data-append-delivery-state]');
      const supportedIndicator = supported.locator('span[aria-hidden="true"]');
      const unsupportedIndicator = unsupported.locator('span[aria-hidden="true"]');
      assert.equal(await supportedIndicator.evaluate((el) => getComputedStyle(el).animationName), 'pulse');
      assert.equal(await supportedIndicator.evaluate((el) => getComputedStyle(el).width), '6px');
      assert.notEqual(
        await supportedIndicator.evaluate((el) => getComputedStyle(el).backgroundColor),
        'rgba(0, 0, 0, 0)',
      );
      assert.equal(await unsupportedIndicator.evaluate((el) => getComputedStyle(el).animationName), 'none');
      await supported.focus();
      await page.getByRole('tooltip').waitFor();
      const expectedTooltip =
        /^已收到 lang · \d{2}\/\d{2} \d{2}:\d{2}:\d{2}\n请保留这个消息的准确归属，并继续原任务。$/;
      assert.match(await page.getByRole('tooltip').innerText(), expectedTooltip);
      await page.keyboard.press('Escape');
      await unsupported.hover();
      await page.getByRole('tooltip').waitFor();
      assert.match(await page.getByRole('tooltip').innerText(), expectedTooltip);
      assert.equal(await unsupported.getAttribute('data-append-delivery-state'), 'unavailable');
      for (const width of [1100, 360]) {
        await page.setViewportSize({ width, height: 650 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (process.env.APPEND_READ_EVIDENCE_DIR) {
          await mkdir(process.env.APPEND_READ_EVIDENCE_DIR, { recursive: true });
          await page.screenshot({
            path: path.join(process.env.APPEND_READ_EVIDENCE_DIR, `append-pending-${width}.png`),
            fullPage: true,
          });
        }
      }
      await supported.click();
      await page.getByRole('tooltip').waitFor();
      await page.getByRole('button', { name: 'terminal', exact: true }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-appended-input-id="supported"] [data-append-delivery-state]')
            ?.getAttribute('data-append-delivery-state') === 'unconfirmed',
      );
      assert.equal(await supportedIndicator.evaluate((el) => getComputedStyle(el).animationName), 'none');
      assert.match(await supported.getAttribute('aria-label'), /已收到 lang（未确认读取）/);
      await page.getByRole('button', { name: 'read', exact: true }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-appended-input-id="supported"] [data-append-delivery-state]')
            ?.getAttribute('data-append-delivery-state') === 'read',
      );
      assert.match(await supported.getAttribute('aria-label'), /^已读(?:\s|$)/);
      assert.equal(await unsupported.getAttribute('data-append-delivery-state'), 'unavailable');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('button', { name: 'pending', exact: true }).click();
      assert.equal(await supportedIndicator.evaluate((el) => getComputedStyle(el).animationName), 'none');
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
