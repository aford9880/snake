#!/usr/bin/env node
/*
 * Сборка билда под конкретную площадку.
 *
 *   node tools/build.mjs yandex     -> build/yandex/ + build/yandex.zip
 *   node tools/build.mjs mock       -> build/mock/   + build/mock.zip
 *   node tools/build.mjs --all      -> все зарегистрированные платформы
 *
 * Что делает сборка (и только она — игровой код при этом не меняется):
 *   1. копирует общие файлы игры;
 *   2. подставляет в <head> загрузчик SDK нужной площадки (маркер PLATFORM_HEAD);
 *   3. записывает js/platform.config.js с идентификатором площадки;
 *   4. кладёт только нужные адаптеры (core + mock как фолбэк + выбранный);
 *   5. пакует результат в zip.
 *
 * Zip пишется вручную: пути внутри архива всегда через «/» — Compress-Archive
 * старых версий PowerShell кладёт их через «\», и хостинг Яндекс Игр такой
 * архив не принимает.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = path.join(ROOT, 'build');
const HEAD_MARKER = '<!--PLATFORM_HEAD-->';

/*
 * Описание платформ сборки. Добавить площадку = добавить сюда запись и файл
 * адаптера js/platform/<id>/<id>-platform.js.
 */
const PLATFORMS = {
  mock: {
    head: '',
    description: 'локальная сборка без SDK',
  },
  yandex: {
    head: [
      '<!-- Yandex Games SDK must load in <head> before YaGames.init() is called. -->',
      '<script src="/sdk.js"></script>',
      '<script>',
      '  // Initialise immediately after the official loader so Yandex can record init.',
      '  // Keep standalone/local launches free of a ReferenceError when /sdk.js is absent.',
      "  window.__yandexSdkPromise = typeof YaGames !== 'undefined' ? YaGames.init() : null;",
      '</script>',
    ].join('\n'),
    description: 'Яндекс Игры',
  },
  vk: {
    head: [
      '<!-- VK Bridge ships with the build: VK asks not to depend on external CDNs. -->',
      '<script src="js/vendor/vk-bridge.min.js"></script>',
      '<script>',
      '  // VKWebAppInit must be sent before the main resources load.',
      "  window.__vkBridgeInit = typeof vkBridge !== 'undefined' ? vkBridge.send('VKWebAppInit', {}) : null;",
      '</script>',
    ].join('\n'),
    /* Библиотека моста лежит в репозитории и попадает только в сборку VK. */
    files: ['js/vendor/vk-bridge.min.js'],
    /*
     * Требование каталога игр VK: в игре должен быть канал связи с поддержкой.
     * Игра показывает его в окне «Как играть».
     */
    config: { support: 'alex_bk@list.ru' },
    description: 'VK Игры',
  },
};

/* Общие файлы игры, одинаковые для всех площадок. */
const SHARED = [
  'index.html',
  'css/style.css',
  'js/boot.js',
  'js/core/game.js',
  'js/core/i18n.js',
  'js/platform/core/errors.js',
  'js/platform/core/events.js',
  'js/platform/core/factory.js',
  'js/platform/core/interstitial-policy.js',
  'js/platform/core/local-storage.js',
  'js/platform/core/models.js',
  'js/platform/core/platform-services.js',
  'js/platform/core/services.js',
  /* mock нужен в любой сборке: фабрика подставляет его, если SDK не отвечает. */
  'js/platform/mock/mock-platform.js',
];

function adapterFiles(platformId) {
  const adapter = platformId === 'mock' ? [] : [`js/platform/${platformId}/${platformId}-platform.js`];
  return [...adapter, ...(PLATFORMS[platformId].files ?? [])];
}

function configSource(platformId) {
  const config = {
    platform: platformId,
    saveKey: 'snakeSave',
    ...(PLATFORMS[platformId].config ?? {}),
  };
  const body = Object.entries(config)
    .map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`)
    .join('\n');
  return `/* Сгенерировано tools/build.mjs — не редактировать в сборке. */
export const platformConfig = {
${body}
};
`;
}

async function buildPlatform(platformId) {
  const platform = PLATFORMS[platformId];
  if (!platform) {
    throw new Error(`Unknown platform "${platformId}". Known: ${Object.keys(PLATFORMS).join(', ')}`);
  }

  const outDir = path.join(OUT_ROOT, platformId);
  await fs.rm(outDir, { recursive: true, force: true });

  const entries = [];
  for (const relative of [...SHARED, ...adapterFiles(platformId)]) {
    let content = await fs.readFile(path.join(ROOT, relative));
    if (relative === 'index.html') {
      const html = content.toString('utf8');
      if (!html.includes(HEAD_MARKER)) {
        throw new Error(`index.html is missing the ${HEAD_MARKER} marker`);
      }
      content = Buffer.from(html.replace(HEAD_MARKER, platform.head), 'utf8');
    }
    entries.push({ name: relative, data: content });
  }
  entries.push({ name: 'js/platform.config.js', data: Buffer.from(configSource(platformId), 'utf8') });

  for (const entry of entries) {
    const target = path.join(outDir, entry.name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.data);
  }

  const zipPath = path.join(OUT_ROOT, `${platformId}.zip`);
  await fs.writeFile(zipPath, createZip(entries));

  const bytes = entries.reduce((sum, entry) => sum + entry.data.length, 0);
  console.log(`${platformId.padEnd(7)} ${platform.description}`);
  console.log(`  ${path.relative(ROOT, outDir)}/  (${entries.length} files, ${(bytes / 1024).toFixed(1)} KB)`);
  console.log(`  ${path.relative(ROOT, zipPath)}`);
}

/* ==== минимальный zip-писатель (store/deflate, пути через «/») ==== */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function createZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name.split(path.sep).join('/'), 'utf8');
    const raw = entry.data;
    const deflated = deflateRawSync(raw);
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);       // version needed
    local.writeUInt16LE(0x0800, 6);   // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);       // time
    local.writeUInt16LE(0x2821, 12);  // date: 2020-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, body);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);      // version made by
    header.writeUInt16LE(20, 6);      // version needed
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0x2821, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(0, 38);      // external attributes
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuffer, end]);
}

/* ==== entry point ==== */

const args = process.argv.slice(2);
const targets = args.length === 0 || args[0] === '--all' ? Object.keys(PLATFORMS) : args;

for (const target of targets) {
  await buildPlatform(target);
}
