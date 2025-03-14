export type LogFn = (msg: string, val?: unknown) => void;

export interface LogOptions {
  logFn?: LogFn;
  errorFn?: LogFn;
}

export interface AggregatorLogOptions extends LogOptions {
  aggregatorFn?: () => Aggregator;
  storeCalls?: boolean;
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

  setFn(name: string, options: LogOptions) {
    this.name = name;
    this.opts = options;
  }

  log(tag: string, val: unknown) {
    this.opts.logFn?.(`${this.name}_${tag}`, val);
  }

  error(tag: string, err?: unknown) {
    this.opts.errorFn?.(`${this.name}_${tag}`, err);
  }
}

export class ExternalAggregatorLog extends ExternalLog {
  protected opts: AggregatorLogOptions = {};

  setFn(name: string, options: AggregatorLogOptions) {
    super.setFn(name, options);
    this.opts = options;
  }

  aggregate(tag: string, log: Record<string, unknown>, props: string[]) {
    const ag = this.opts.aggregatorFn?.();

    if (ag && props) {
      ag.count = (ag.count ?? 0) + 1;
      ag.counts[tag] = (ag.counts[tag] ?? 0) + 1;

      if (this.opts.storeCalls) {
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

      if (!this.opts.storeCalls) {
        super.log(tag, log);
      }
    }
  }
}
