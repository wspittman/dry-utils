type LogFn = (msg: string, val?: unknown) => void;

export interface Aggregator {
  count: number;
  counts: Record<string, number>;
  calls?: Record<string, unknown>[];
  [key: string]: unknown;
}

class ExternalLog {
  private _name: string | undefined;
  private _logFn: LogFn | undefined;
  private _errorFn: LogFn | undefined;

  setFn(name: string, logFn?: LogFn, errorFn?: LogFn) {
    this._name = name;
    this._logFn = logFn;
    this._errorFn = errorFn;
  }

  log(tag: string, val: unknown) {
    this._logFn?.(`${this._name}_${tag}`, val);
  }

  error(tag: string, err?: unknown) {
    this._errorFn?.(`${this._name}_${tag}`, err);
  }
}

class ExternalAggregatorLog extends ExternalLog {
  private _aggregateProps: string[] | undefined;
  private _aggregatorFn: (() => Aggregator) | undefined;
  private _storeCalls: boolean | undefined;

  setFn(
    name: string,
    logFn?: LogFn,
    errorFn?: LogFn,
    aggregatorFn?: () => Aggregator,
    aggregateProps?: string[],
    storeCalls?: boolean
  ) {
    super.setFn(name, logFn, errorFn);
    this._aggregatorFn = aggregatorFn;
    this._aggregateProps = aggregateProps;
    this._storeCalls = storeCalls;
  }

  aggregate(tag: string, log: Record<string, unknown>) {
    const ag = this._aggregatorFn?.();
    const props = this._aggregateProps;

    if (ag && props) {
      ag.count = (ag.count ?? 0) + 1;
      ag.counts[tag] = (ag.counts[tag] ?? 0) + 1;

      if (this._storeCalls) {
        ag.calls = ag.calls ?? [];
        if (ag.calls.length < 10) {
          ag.calls.push(log);
        }
      }

      props.forEach((key) => {
        ag[key] = ag[key] ?? 0;
        if (typeof log[key] === "number" && typeof ag[key] === "number") {
          ag[key] += log[key];
        }
      });

      if (!this._storeCalls) {
        super.log(tag, log);
      }
    }
  }
}

export const externalLog = new ExternalAggregatorLog();
