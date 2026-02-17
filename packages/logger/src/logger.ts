import type { TransformableInfo } from "logform";
import { createLogger, format, type Logger, transports } from "winston";

/**
 * Extended interface for logger info objects with additional splat properties
 */
interface LoggerInfo extends TransformableInfo {
  timestamp?: string;
  simpleSplat?: unknown;
  fullSplat?: unknown;
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

/**
 * Simplifies complex values for better console logging
 *
 * @param val - The value to simplify
 * @param depth - Current recursion depth
 * @returns A simplified representation of the value
 */
function getSimpleVal(val: unknown, depth = 0): unknown {
  // Handle null explicitly to avoid errors
  if (val == null) return undefined;

  if (Array.isArray(val)) {
    return val.length > 10 || depth >= 2
      ? `[Length = ${val.length}]`
      : val.map((x) => getSimpleVal(x, depth + 1));
  }

  if (val instanceof Date) {
    return val.toISOString();
  }

  if (typeof val === "object") {
    if (depth >= 2) return "[Object]";
    try {
      return Object.fromEntries(
        Object.entries(val).map(([key, value]) => {
          return [key, getSimpleVal(value, depth + 1)];
        }),
      );
    } catch {
      // Handle potential errors when converting objects
      return "[Unserializable Object]";
    }
  }

  return val;
}

const addSplat = format((info: LoggerInfo) => {
  const splat = (info as Record<symbol, unknown>)[Symbol.for("splat")];
  const val = Array.isArray(splat) ? (splat as unknown[])[0] : splat;
  info.simpleSplat = getSimpleVal(val);
  info.fullSplat = val;
  return info;
})();

const formatPrint = (splatType: string) =>
  format.printf((info: LoggerInfo) => {
    const { timestamp = "", level, message } = info;
    const splat = info[splatType as keyof LoggerInfo];
    const isCollapse = Array.isArray(splat) && typeof splat[0] !== "object";
    const expandVal = isCollapse ? undefined : 2;
    const splatString =
      splat == null ? "" : `: ${JSON.stringify(splat, null, expandVal) ?? ""}`;
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
        format: formatPrint("simpleSplat"),
      }),
      new transports.File({
        filename: config.filename,
        level: config.fileLevel,
        format: formatPrint("fullSplat"),
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
