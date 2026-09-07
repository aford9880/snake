#!/usr/bin/env node
/*
 * Снимки экрана для карточек площадок.
 *
 *   node tools/screenshots.mjs            # 1200×600, как просит VK Игры
 *   node tools/screenshots.mjs 1280 720
 *
 * Скрипт поднимает сборку в установленном Chrome (puppeteer-core, без своей
 * копии браузера), проходит по игре и сохраняет кадры в assets/vk/.
 * Игра запускается на mock-платформе — визуально это та же самая сборка.
 */

import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build', 'vk');
const OUT = path.join(ROOT, 'assets', 'vk');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8137;

const [width = 1200, height = 600] = process.argv.slice(2).map(Number);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

/* Статика прямо из сборки: модулям ES нужен http, файлом их не открыть. */
function serve() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = path.join(BUILD, url.pathname === '/' ? 'index.html' : url.pathname);
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function shoot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`${name}.png  ${width}×${height}`);
}

const server = await serve();
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  defaultViewport: { width, height, deviceScaleFactor: 1 },
  args: ['--hide-scrollbars'],
});

try {
  await fs.mkdir(OUT, { recursive: true });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/index.html?lang=ru`, { waitUntil: 'networkidle0' });

  /* Обучение открывается при первом запуске — закрываем и снимаем игру. */
  await page.click('#helpStart');
  await page.click('#pauseBtn');          // обучение поставило раунд на паузу
  await page.click('#autoBtn');           // автопилот наберёт счёт для кадра
  await wait(14000);
  await shoot(page, 'screen1-classic');

  await page.click('#shopBtn');
  await wait(600);
  await shoot(page, 'screen2-shop');
  await page.click('#shopClose');

  /* Третий режим — «Препятствия». */
  await page.evaluate(() => [...document.querySelectorAll('#modeChips .chip')][2].click());
  await wait(12000);
  await shoot(page, 'screen3-obstacles');
} finally {
  await browser.close();
  server.close();
}
