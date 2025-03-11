import type { TransformableInfo } from "logform";
import { createLogger, format, Logger, transports } from "winston";

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
  if (val === null) return null;

  if (Array.isArray(val)) {
    return val.length > 10 || depth >= 2
      ? `[Length = ${val.length}]`
      : val.map((x) => getSimpleVal(x, depth + 1));
  }

  if (val instanceof Date) {
    return val.toISOString();
  }

  if (typeof val === "object" && val !== null) {
    if (depth >= 2) return "[Object]";
    try {
      return Object.fromEntries(
        Object.entries(val).map(([key, value]) => {
          return [key, getSimpleVal(value, depth + 1)];
        })
      );
    } catch (err) {
      // Handle potential errors when converting objects
      return "[Unserializable Object]";
    }
  }

  return val;
}

const addSplat = format((info: LoggerInfo) => {
  const { [Symbol.for("splat")]: splat } = info;
  const val = Array.isArray(splat) ? splat[0] : splat;
  info.simpleSplat = getSimpleVal(val);
  info.fullSplat = val;
  return info;
})();

const formatPrint = (splatType: string) =>
  format.printf((info: LoggerInfo) => {
    const { timestamp, level, message } = info;
    const splat = info[splatType];
    const isCollapse = Array.isArray(splat) && typeof splat[0] !== "object";
    const expandVal = isCollapse ? undefined : 2;
    const splatString =
      splat == null ? "" : `: ${JSON.stringify(splat, null, expandVal)}`;
    return `${timestamp} [${level.toUpperCase()}]: ${message}${splatString}`;
  });

/**
 * Creates a custom logger instance with the specified configuration
 *
 * @param options - Configuration options for the logger
 * @returns A configured Winston logger instance
 */
export function createCustomLogger(options: LoggerConfig): Logger {
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
  logger.info(`Logger initialized @ ${start.toISOString()}`);
  return logger;
}

/**
 * Singleton class to manage a global logger instance
 */
class LoggerSingleton {
  private static _instance: Logger | null = null;
  private static _config: LoggerConfig = {};

  /**
   * Configures the singleton logger with the specified options
   *
   * @param options - Configuration options for the logger
   */
  static configure(options: LoggerConfig): void {
    this._config = options;
    // Reset instance to apply new config
    this._instance = null;
  }

  /**
   * Gets the logger instance, creating it if it doesn't exist
   */
  static get instance(): Logger {
    if (!this._instance) {
      this._instance = createCustomLogger(this._config);
    }
    return this._instance;
  }
}

/**
 * Configures the global logger singleton
 *
 * @param options - Configuration options for the logger
 */
export function configureLogger(options: LoggerConfig): void {
  LoggerSingleton.configure(options);
}

/**
 * The global logger instance
 */
export const logger = LoggerSingleton.instance;
