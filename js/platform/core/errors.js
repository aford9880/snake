/*
 * Ошибки платформенного слоя.
 *
 * Ни один тип исключения конкретного SDK не должен покидать адаптер: адаптер
 * ловит «своё» и заворачивает в PlatformError, у которого есть стабильный код
 * и текстовая расшифровка. Игровой код ловит только PlatformError.
 */

export const PlatformErrorCode = {
  UNSUPPORTED: 'unsupported',   // возможность отсутствует на этой платформе
  NOT_READY: 'not_ready',       // SDK ещё не инициализирован
  REJECTED: 'rejected',         // пользователь отказался (закрыл рекламу, отменил покупку)
  NETWORK: 'network',
  SDK: 'sdk',                   // ошибка внутри SDK платформы
  UNKNOWN: 'unknown',
};

export class PlatformError extends Error {
  constructor(code, message, details = '') {
    super(message || code);
    this.name = 'PlatformError';
    this.code = code;
    /* Только строка: объект ошибки SDK наружу не отдаём. */
    this.details = details;
  }

  /* Единая точка преобразования «чужой» ошибки в собственную модель. */
  static wrap(error, code = PlatformErrorCode.SDK, message = '') {
    if (error instanceof PlatformError) return error;
    const details = error == null
      ? ''
      : String(error.message ?? error.toString?.() ?? error);
    return new PlatformError(code, message || details || code, details);
  }

  static unsupported(what = 'feature') {
    return new PlatformError(PlatformErrorCode.UNSUPPORTED, `${what} is not supported on this platform`);
  }
}
