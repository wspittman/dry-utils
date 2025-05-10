export type LogFn = (msg: string, val?: unknown) => void;

export interface LogOptions {
  logFn?: LogFn;
  errorFn?: LogFn;
}

export interface AggregatorLogOptions extends LogOptions {
  aggregatorFn?: () => Aggregator;
  storeCalls?: number;
  logCallFn?: LogFn;
  logBlobFn?: LogFn;
}

export interface Aggregator {
  count: number;
  counts: Record<string, number>;
  calls?: Record<string, unknown>[];
  [key: string]: unknown;
}

export class ExternalLog {
  protected name: string | undefined;
  protected opts: LogOptions = {};

  setFn(name: string, options: LogOptions): void {
    this.name = name;
    this.opts = options;
  }

  log(tag: string, val: unknown): void {
    this.opts.logFn?.(`${this.name}_${tag}`, val);
  }

  error(tag: string, err?: unknown): void {
    this.opts.errorFn?.(`${this.name}_${tag}`, err);
  }
}

export class ExternalAggregatorLog extends ExternalLog {
  protected override opts: AggregatorLogOptions = {};

  override setFn(name: string, options: AggregatorLogOptions): void {
    super.setFn(name, options);
    this.opts = options;
  }

  aggregate(
    tag: string,
    log: Record<string, unknown>,
    blob: Record<string, unknown>,
    props: string[]
  ): void {
    const ag = this.opts.aggregatorFn?.();

    if (!ag) return;

    ag.count = (ag.count ?? 0) + 1;
    ag.counts[tag] = (ag.counts[tag] ?? 0) + 1;

    if (this.opts.storeCalls) {
      ag.calls = ag.calls ?? [];
      if (ag.calls.length < this.opts.storeCalls) {
        ag.calls.push(log);
      }
    }

    if (this.opts.logCallFn) {
      this.opts.logCallFn(`${this.name}_${tag}`, log);
    }

    if (this.opts.logBlobFn) {
      this.opts.logBlobFn(`${this.name}_${tag}`, blob);
    }

    props.forEach((key) => {
      ag[key] = ag[key] ?? 0;
      if (typeof log[key] === "number" && typeof ag[key] === "number") {
        ag[key] += log[key];
      }
    });
  }
}
