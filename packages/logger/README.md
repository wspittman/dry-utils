# dry-utils-logger

A Winston wrapper logger for Node.js applications with simplified configuration and smart formatting for development and production environments.

I do not anticipate that you will find this repository useful. It is hyper-specific to my needs. If you do find something useful, feel free to use it, fork it, or liberally copy code out into your own projects.

## Installation

Prerequisites:

- Node.js >=24.0.0

Install:

```bash
npm install dry-utils-logger
```

## Features

- **Simplified API**: Easy-to-use wrapper around Winston
- **Dual Output**: Console-friendly simplified output and detailed file logging
- **Smart Formatting**: Automatically simplifies complex objects for console output
- **Configurable**: Customize log levels for different transport methods
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
  level: "debug",
  filename: "logs/custom-service.log",
  consoleLevel: "info",
  fileLevel: "debug",
});

logger.info("Custom logger initialized");
```

### Configuring the Global Logger

Configure the global logger instance:

```typescript
import { configureGlobal, logger } from "dry-utils-logger";

// Set global configuration
configureGlobal({
  level: "debug",
  filename: "logs/app.log",
  consoleLevel: "info",
  fileLevel: "verbose",
});

// The logger will use the new configuration
logger.info("Using reconfigured global logger");
```

## Configuration Options

| Option         | Description                  | Default          |
| -------------- | ---------------------------- | ---------------- |
| `level`        | Default logging level        | `"info"`         |
| `filename`     | Path to log file             | `"logs/app.log"` |
| `consoleLevel` | Log level for console output | `"info"`         |
| `fileLevel`    | Log level for file output    | `"debug"`        |
