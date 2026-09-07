/*
 * Собственные модели данных платформенного слоя.
 *
 * Наружу (в игру) отдаются только они — объекты SDK (YandexPlayer, рекламные
 * колбэки, ответы лидербордов) остаются внутри адаптеров.
 */

export const AdStatus = {
  SHOWN: 'shown',             // ролик реально показан
  SKIPPED: 'skipped',         // показ пропущен политикой частоты/платформой
  UNSUPPORTED: 'unsupported', // платформа не умеет такую рекламу
  ERROR: 'error',
};

/* Результат показа рекламы. Никаких типов SDK внутри. */
export function createAdResult({ status, rewarded = false, error = null }) {
  return Object.freeze({
    status,
    rewarded,
    error,
    get ok() { return status === AdStatus.SHOWN || status === AdStatus.SKIPPED; },
  });
}

export const AdResult = {
  shown: (rewarded = false) => createAdResult({ status: AdStatus.SHOWN, rewarded }),
  skipped: () => createAdResult({ status: AdStatus.SKIPPED }),
  unsupported: () => createAdResult({ status: AdStatus.UNSUPPORTED }),
  failed: (error) => createAdResult({ status: AdStatus.ERROR, error }),
};

/* Профиль игрока в терминах проекта, а не платформы. */
export function createPlayerData({
  id = '',
  name = '',
  avatarUrl = '',
  isAuthorized = false,
} = {}) {
  return Object.freeze({ id, name, avatarUrl, isAuthorized });
}

export function createLeaderboardEntry({ rank = 0, score = 0, name = '', isCurrentPlayer = false } = {}) {
  return Object.freeze({ rank, score, name, isCurrentPlayer });
}

/* Окружение запуска: язык, тип устройства, идентификатор платформы. */
export function createEnvironment({ platformId = 'unknown', language = 'ru', deviceType = 'desktop' } = {}) {
  return Object.freeze({ platformId, language, deviceType });
}

export function createProduct({ id = '', title = '', description = '', price = '', priceValue = 0 } = {}) {
  return Object.freeze({ id, title, description, price, priceValue });
}

export function createPurchaseResult({ productId = '', purchased = false, error = null } = {}) {
  return Object.freeze({ productId, purchased, error });
}
