# dry-utils-logger

A TSLog wrapper logger for Node.js applications with simplified configuration, pretty console output, and detailed file logging.

I do not anticipate that you will find this repository useful. It is hyper-specific to my needs. If you do find something useful, feel free to use it, fork it, or liberally copy code out into your own projects.

## Installation

Prerequisites:

- Node.js >=24.0.0

Install:

```bash
npm install dry-utils-logger
```

## Features

- **Simplified API**: Global logger and custom TSLog logger instances
- **Dual Output**: Pretty console output and detailed file logging
- **Formatting**: Limits console arrays to 10 items and preserves error details in file output
- **Configurable**: Separate minimum log levels for the logger, console, and file output
- **Global Logger**: Singleton pattern with lazy initialization

## Usage

### Basic Usage

Use the global logger instance:

```typescript
import { logger } from "dry-utils-logger";

// Simple message logging
logger.info("Application started");

// Logging with metadata
logger.debug("User login attempt", { userId: "123", ip: "192.168.1.1" });

// Error logging
try {
  // Some operation
} catch (error) {
  logger.error("Failed to process request", error);
}
```

### Custom Logger Instance

Create a custom logger with specific configuration:

```typescript
import { createCustomLogger } from "dry-utils-logger";

const logger = createCustomLogger({
  level: "DEBUG",
  filename: "logs/custom-service.log",
  consoleLevel: "INFO",
  fileLevel: "DEBUG",
});

logger.info("Custom logger initialized");
```

`createCustomLogger(options, omitInitMsg)` returns a TSLog `Logger<ILogObj>` instance. Pass `true` as the second argument to suppress the initialization message. Custom instances expose TSLog methods such as `flush()` to wait for pending log writes.

### Configuring the Global Logger

Configure the global logger instance:

```typescript
import { configureGlobal, logger } from "dry-utils-logger";

// Set global configuration
configureGlobal({
  level: "DEBUG",
  filename: "logs/app.log",
  consoleLevel: "INFO",
  fileLevel: "TRACE",
});

// The logger will use the new configuration
logger.info("Using reconfigured global logger");
```

`configureGlobal` replaces the global configuration. The next logging call creates a new logger using those options and defaults for omitted fields.

## Configuration Options

| Option         | Description                           | Default          |
| -------------- | ------------------------------------- | ---------------- |
| `level`        | Minimum level for the logger instance | `"SILLY"`        |
| `filename`     | Path to log file                      | `"logs/app.log"` |
| `consoleLevel` | Minimum level for console output      | `"INFO"`         |
| `fileLevel`    | Minimum level for file output         | `"DEBUG"`        |

Level options use uppercase TSLog names, ordered from least to most severe: `SILLY`, `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. Logging methods remain lowercase: `logger.silly()`, `logger.trace()`, `logger.debug()`, `logger.info()`, `logger.warn()`, `logger.error()`, and `logger.fatal()`.

A message must meet both the logger's `level` and the output's minimum level. With the defaults, debug messages go to the file, while info and higher messages go to both outputs. In the global configuration example above, `level: "DEBUG"` filters out trace messages even though `fileLevel` is `"TRACE"`.

## Migrating from Winston

- Change lowercase configuration levels to uppercase TSLog names, such as `"info"` to `"INFO"`.
- Replace the former `verbose` level and method with an appropriate TSLog level, such as `TRACE` and `logger.trace()`.
- Custom logger instances now expose the TSLog API. Update any code that uses Winston-specific methods or transports.
