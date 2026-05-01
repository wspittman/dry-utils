import type { TransformableInfo } from "logform";
import { inspect } from "node:util";
import { createLogger, format, type Logger, transports } from "winston";

/**
 * Extended interface for logger info objects with additional splat properties
 */
interface LoggerInfo extends TransformableInfo {
  timestamp?: string;
  splat?: unknown;
}

/**
 * Configuration interface for the logger
 */
export interface LoggerConfig {
  /** Log level for the logger instance */
  level?: string;
  /** Path to the log file */
  filename?: string;
  /** Log level for console output */
  consoleLevel?: string;
  /** Log level for file output */
  fileLevel?: string;
}

/**
 * Default configuration for the logger
 */
const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  level: "info",
  filename: "logs/app.log",
  consoleLevel: "info",
  fileLevel: "debug",
};

const errorReplacer = (_key: string, value: unknown): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...Object.fromEntries(Object.entries(value)),
    };
  }
  return value;
};

const addSplat = format((info: LoggerInfo) => {
  const splat = (info as Record<symbol, unknown>)[Symbol.for("splat")];
  const val = Array.isArray(splat) ? (splat as unknown[])[0] : splat;
  info.splat = val;
  return info;
})();

const formatPrint = (isConsole: boolean) =>
  format.printf((info: LoggerInfo) => {
    const { timestamp = "", level, message, splat } = info;

    let splatString = "";
    if (splat != null) {
      if (isConsole) {
        splatString =
          ": " + inspect(splat, { colors: true, maxArrayLength: 10 });
      } else {
        const isCollapse = Array.isArray(splat) && typeof splat[0] !== "object";
        const expandVal = isCollapse ? undefined : 2;
        splatString = `: ${JSON.stringify(splat, errorReplacer, expandVal) ?? ""}`;
      }
    }
    return `${timestamp} [${level.toUpperCase()}]: ${String(message)}${splatString}`;
  });

/**
 * Creates a custom logger instance with the specified configuration
 *
 * @param options - Configuration options for the logger
 * @param omitInitMsg - Whether to omit the initialization message
 * @returns A configured Winston logger instance
 */
export function createCustomLogger(
  options: LoggerConfig = {},
  omitInitMsg = false,
): Logger {
  const config = { ...DEFAULT_LOGGER_CONFIG, ...options };
  const start = new Date();
  const startTime = start.getTime();

  const addTimestamp = format.timestamp({
    format: () => new Date(Date.now() - startTime).toISOString().slice(14, 23),
  });

  const logger = createLogger({
    level: config.level,
    format: format.combine(addTimestamp, addSplat),
    transports: [
      new transports.Console({
        level: config.consoleLevel,
        format: formatPrint(true),
      }),
      new transports.File({
        filename: config.filename,
        level: config.fileLevel,
        format: formatPrint(false),
      }),
    ],
  });

  if (!omitInitMsg) {
    logger.info(`Logger initialized @ ${start.toISOString()}`);
  }

  return logger;
}

// Create a lazy-loaded default logger that's only initialized when first accessed
let _defaultLogger: Logger | undefined;
let _defaultConfig: LoggerConfig = {};

/**
 * Configures the global logger singleton
 *
 * @param options - Configuration options for the logger
 */
export function configureGlobal(options: LoggerConfig): void {
  _defaultConfig = options;
  // Reset instance to apply new config
  _defaultLogger = undefined;
}

/**
 * The global logger instance
 */
export const logger: Logger = new Proxy({} as Logger, {
  get(_, prop) {
    if (!_defaultLogger) {
      _defaultLogger = createCustomLogger(_defaultConfig);
    }
    return _defaultLogger[prop as keyof Logger] as unknown;
  },
});
