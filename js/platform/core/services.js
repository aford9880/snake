/*
 * Контракты платформенных сервисов (роль интерфейсов в JS).
 *
 * Разделены по назначению (Interface Segregation): игре, которой нужна только
 * реклама, незачем знать о платежах. Базовая реализация каждого сервиса —
 * «ничего не умею»: адаптер переопределяет ровно то, что поддерживает
 * платформа, а игра проверяет не название платформы, а capabilities.
 */

import { AdResult, createPlayerData, createPurchaseResult } from './models.js';
import { PlatformError } from './errors.js';

/* Реклама. */
export class AdsService {
  /* { interstitial: boolean, rewarded: boolean } */
  get capabilities() {
    return { interstitial: false, rewarded: false };
  }

  /* Межстраничная реклама. Всегда резолвится, никогда не бросает. */
  async showInterstitial() {
    return AdResult.unsupported();
  }

  /* Реклама за награду. result.rewarded === true только если ролик досмотрен. */
  async showRewarded() {
    return AdResult.unsupported();
  }
}

/* Сохранения. */
export class StorageService {
  /* @returns {Promise<object|null>} */
  async load() {
    return null;
  }

  /* @returns {Promise<boolean>} успех записи; ошибки не бросаются наружу */
  async save(_data) {
    return false;
  }
}

/* Лидерборды. */
export class LeaderboardService {
  /* Площадка умеет принимать счёт в фоне, без участия игрока. */
  get available() {
    return false;
  }

  async submitScore(_score) {
    return false;
  }

  /* @returns {Promise<LeaderboardEntry[]>} */
  async getTop(_limit = 10) {
    return [];
  }

  /*
   * Площадка умеет показать собственное окно с таблицей результатов.
   * Есть площадки (VK), где это единственный доступный вид лидерборда:
   * тихой отправки счёта нет, зато есть готовый диалог. Игра показывает
   * кнопку «Таблица результатов», только если возможность объявлена.
   */
  get canShowUi() {
    return false;
  }

  /* Открыть окно площадки. @returns {Promise<boolean>} показано ли окно */
  async showUi(_score) {
    return false;
  }
}

/*
 * Жизненный цикл: сообщения хосту о готовности игры и о границах раунда.
 * У Яндекса это LoadingAPI/GameplayAPI, у других площадок — свои аналоги
 * или пустые операции.
 */
export class LifecycleService {
  /* Игра загрузилась и отрисовала первый кадр. Вызывается ровно один раз. */
  notifyReady() {}

  /* Начался активный раунд. */
  gameplayStart() {}

  /* Раунд приостановлен или закончен. */
  gameplayStop() {}
}

/* Игрок / авторизация. */
export class PlayerService {
  get available() {
    return false;
  }

  async getPlayer() {
    return createPlayerData();
  }

  async authorize() {
    return createPlayerData();
  }
}

/* Внутриигровые покупки. */
export class PaymentsService {
  get available() {
    return false;
  }

  async getProducts() {
    return [];
  }

  async purchase(productId) {
    return createPurchaseResult({ productId, error: PlatformError.unsupported('payments') });
  }
}
