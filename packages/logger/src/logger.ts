import { inspect } from "node:util";
import {
  Logger,
  LogLevel,
  type IErrorObject,
  type ILogObj,
  type ILogObjMeta,
  type ISettings,
} from "tslog";
import { fileTransport } from "tslog/transports/file";

type LogLevelName = keyof typeof LogLevel;
type LogFnName = Lowercase<LogLevelName>;
type ApiFn = (msg: string, ...args: unknown[]) => void;

/** Configuration interface for the logger */
export interface LoggerConfig {
  /** Log level for the logger instance */
  level?: LogLevelName;
  /** Path to the log file */
  filename?: string;
  /** Log level for console output */
  consoleLevel?: LogLevelName;
  /** Log level for file output */
  fileLevel?: LogLevelName;
}

/** Default configuration for the logger */
const defaults: Required<LoggerConfig> = {
  level: "SILLY",
  filename: "logs/app.log",
  consoleLevel: "INFO",
  fileLevel: "DEBUG",
};

/**
 * Creates a custom logger instance with the specified configuration
 *
 * @param options Configuration options for the logger
 * @param omitInitMsg Whether to omit the initialization message
 * @returns A configured TSLog logger instance
 */
export function createCustomLogger(
  options: LoggerConfig = {},
  omitInitMsg = false,
): Logger<ILogObj> {
  const config = { ...defaults, ...options };
  const log = new Logger<ILogObj>({
    type: "hidden",
    minLevel: config.level,
    pretty: {
      template:
        "{{yyyy}}-{{mm}}-{{dd}} {{hh}}:{{MM}}:{{ss}}.{{ms}} {{logLevelName}} ",
      inspectOptions: { maxArrayLength: 10 },
    },
  });

  log.attachTransport({
    name: "console",
    minLevel: config.consoleLevel,
    format: "pretty",
    write: (_record, line) => console.log(line),
  });
  log.attachTransport(
    fileTransport({
      path: config.filename,
      minLevel: config.fileLevel,
      format: formatFile,
    }),
  );

  if (!omitInitMsg) {
    log.info(`Logger initialized @ ${new Date().toISOString()}`);
  }

  return log;
}

function formatFile(
  record: ILogObj & ILogObjMeta,
  settings: ISettings<ILogObj>,
): string {
  if (!record) return "";
  const { [settings.meta.property]: meta, ...rest } = record;
  if (!meta) return "";
  const values = Object.values(rest);

  let splatString = "";
  for (const value of values) {
    const isCollapse = Array.isArray(value) && typeof value[0] !== "object";
    const expandVal = isCollapse ? undefined : 2;
    try {
      splatString += `: ${JSON.stringify(value, errorReplacer, expandVal)}`;
    } catch {
      // Fallback if circular references or other serialization issues
      splatString +=
        ": " + inspect(value, { colors: true, maxArrayLength: 10 });
    }
  }

  return `${meta.date.toISOString()} ${meta.logLevelName}${splatString}`;
}

const errorReplacer = (_key: string, value: unknown): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...Object.fromEntries(Object.entries(value)),
    };
  }
  if (isErrorObject(value)) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack.map((x) => x.filePathWithLine),
    };
  }
  return value;
};

function isErrorObject(value: unknown): value is IErrorObject {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj["name"] === "string" &&
    typeof obj["message"] === "string" &&
    obj["nativeError"] instanceof Error &&
    Array.isArray(obj["stack"])
  );
}

let current: Logger<ILogObj> | undefined;
let globalConfig: LoggerConfig = {};

function apiFn(str: LogFnName): ApiFn {
  return (msg: string, ...args: unknown[]): void => {
    current ??= createCustomLogger(globalConfig);
    current[str](msg, ...args);
  };
}

/**
 * Configures the global logger singleton
 *
 * @param options Configuration options for the logger
 */
export function configureGlobal(options: LoggerConfig): void {
  globalConfig = options;
  current = undefined;
}

/** The global logger instance */
export const logger: Record<LogFnName, ApiFn> = {
  silly: apiFn("silly"),
  trace: apiFn("trace"),
  debug: apiFn("debug"),
  info: apiFn("info"),
  warn: apiFn("warn"),
  error: apiFn("error"),
  fatal: apiFn("fatal"),
};
