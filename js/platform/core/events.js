/*
 * Платформенно-независимая шина событий.
 *
 * Асинхронные события SDK (пауза хоста, открытие/закрытие рекламы) адаптер
 * переводит в эти константы. Игра подписывается только на них и не знает,
 * какое именно событие SDK было источником.
 */

export const PlatformEvent = {
  AD_OPEN: 'ad:open',       // показ рекламы начался — звук и игровой цикл гасим
  AD_CLOSE: 'ad:close',     // реклама закрыта — можно продолжать
  PAUSE: 'game:pause',      // хост попросил приостановить игру (свернули вкладку и т.п.)
  RESUME: 'game:resume',
};

export class EventBus {
  #listeners = new Map();

  on(event, handler) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    this.#listeners.get(event)?.delete(handler);
  }

  emit(event, payload) {
    for (const handler of this.#listeners.get(event) ?? []) {
      try {
        handler(payload);
      } catch (e) {
        console.warn(`Platform event handler failed for "${event}"`, e);
      }
    }
  }

  clear() {
    this.#listeners.clear();
  }
}
