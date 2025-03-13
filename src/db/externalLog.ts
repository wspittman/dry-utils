type LogFn = (msg: string, val?: unknown) => void;

class ExternalLog {
  private _logFn: LogFn | undefined;
  private _errorFn: LogFn | undefined;

  setFn(logFn?: LogFn, errorFn?: LogFn) {
    this._logFn = logFn;
    this._errorFn = errorFn;
  }

  log(msg: string, val?: unknown) {
    this._logFn?.(msg, val);
  }

  error(msg: string, val?: unknown) {
    this._errorFn?.(msg, val);
  }
}

export const externalLog = new ExternalLog();
