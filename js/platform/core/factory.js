/*
 * Composition root платформенного слоя: выбор и создание адаптера.
 *
 * Это единственное место во всём проекте, где перечислены названия площадок.
 * Добавление платформы = новый файл адаптера + одна строка в ADAPTERS
 * (+ значение в конфигурации сборки). Игровой код при этом не меняется.
 *
 * Адаптеры подключаются динамическим import(), поэтому в собранную страницу
 * попадает код только выбранной площадки, а Game Core не ссылается ни на один
 * SDK даже транзитивно.
 */

import { PlatformServices } from './platform-services.js';

const ADAPTERS = {
  mock: () => import('../mock/mock-platform.js'),
  yandex: () => import('../yandex/yandex-platform.js'),
  vk: () => import('../vk/vk-platform.js'),
};

export function listPlatforms() {
  return Object.keys(ADAPTERS);
}

/*
 * Автоопределение — только для локальной разработки и «универсальной» сборки.
 * В сборке под площадку id задаётся явно в js/platform.config.js.
 */
export function detectPlatformId() {
  const override = new URLSearchParams(window.location.search).get('platform');
  if (override && ADAPTERS[override]) return override;
  if (typeof window.YaGames !== 'undefined') return 'yandex';
  if (typeof window.vkBridge !== 'undefined') return 'vk';
  return 'mock';
}

export async function createPlatform(config = {}) {
  const requested = !config.platform || config.platform === 'auto'
    ? detectPlatformId()
    : config.platform;

  const load = ADAPTERS[requested];
  if (!load) {
    console.warn(`Platform "${requested}" is not registered, falling back to mock`);
    return createFallback(config);
  }

  try {
    const module = await load();
    const platform = await module.createPlatform(config);
    console.log(`Platform: ${platform.id}`);
    return platform;
  } catch (e) {
    /*
     * SDK площадки не отвечает или отсутствует (обычный случай при локальном
     * запуске сборки под площадку) — игра всё равно должна стартовать.
     */
    console.warn(`Platform "${requested}" is unavailable, falling back to mock`, e);
    return createFallback(config);
  }
}

async function createFallback(config) {
  try {
    const module = await ADAPTERS.mock();
    const platform = await module.createPlatform(config);
    console.log(`Platform: ${platform.id} (fallback)`);
    return platform;
  } catch (e) {
    console.warn('Mock platform failed, running with no-op services', e);
    return new PlatformServices({ id: 'none' });
  }
}
