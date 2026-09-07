/*
 * Частотное ограничение межстраничной рекламы.
 *
 * Требование «не чаще раза в минуту и не в первом раунде» есть почти у всех
 * площадок, отличаются только числа, поэтому сама логика лежит в core, а
 * конкретные значения задаёт адаптер платформы.
 */

export class InterstitialPolicy {
  #lastShownAt = 0;
  #rounds = 0;

  constructor({ minIntervalMs = 65000, skipFirstRounds = 1, now = () => Date.now() } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.skipFirstRounds = skipFirstRounds;
    this.now = now;
  }

  /*
   * Вызывается один раз на каждую попытку показа: считает раунды и решает,
   * можно ли показывать. При положительном ответе засекает время показа.
   */
  requestShow() {
    this.#rounds++;
    const now = this.now();
    if (this.#rounds <= this.skipFirstRounds || now - this.#lastShownAt < this.minIntervalMs) {
      return false;
    }
    this.#lastShownAt = now;
    return true;
  }
}
