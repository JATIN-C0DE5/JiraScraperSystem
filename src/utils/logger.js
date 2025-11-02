import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Winston logger with both console and file output
 * Features:
 * - File rotation: 10MB per file, max 5 files
 * - Console: colorized, with timestamps
 * - File: JSON format for easy parsing
 * - Separate error log file
 */
class Logger {
  constructor(config = {}) {
    this.config = {
      level: config.level || 'info',
      console: config.console !== false,
      file: config.file !== false,
      directory: config.directory || 'logs',
      maxFileSize: config.maxFileSize || '10m',
      maxFiles: config.maxFiles || 5,
    };

    this.logger = this.createLogger();
  }

  /**
   * Create Winston logger with custom transports
   */
  createLogger() {
    const transports = [];

    // Console transport (human-readable, colorized)
    if (this.config.console) {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(({ timestamp, level, message, component }) => {
              const comp = component ? `[${component}]` : '';
              return `[${timestamp}] ${level} ${comp} ${message}`;
            })
          ),
        })
      );
    }

    // File transport (JSON format, rotating)
    if (this.config.file) {
      // Combined log file
      transports.push(
        new DailyRotateFile({
          dirname: this.config.directory,
          filename: 'combined-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: this.config.maxFileSize,
          maxFiles: this.config.maxFiles,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
        })
      );

      // Error-only log file
      transports.push(
        new DailyRotateFile({
          dirname: this.config.directory,
          filename: 'error-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          level: 'error',
          maxSize: this.config.maxFileSize,
          maxFiles: this.config.maxFiles,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
        })
      );
    }

    return winston.createLogger({
      level: this.config.level,
      transports,
      exitOnError: false,
    });
  }

  /**
   * Log info message
   */
  info(message, component = null) {
    this.logger.info(message, { component });
  }

  /**
   * Log debug message
   */
  debug(message, component = null) {
    this.logger.debug(message, { component });
  }

  /**
   * Log warning message
   */
  warn(message, component = null) {
    this.logger.warn(message, { component });
  }

  /**
   * Log error message with optional error object
   */
  error(message, error = null, component = null) {
    if (error) {
      this.logger.error(message, {
        component,
        error: {
          message: error.message,
          stack: error.stack,
          code: error.code,
        },
      });
    } else {
      this.logger.error(message, { component });
    }
  }

  /**
   * Create child logger with component name
   */
  child(component) {
    return {
      info: (msg) => this.info(msg, component),
      debug: (msg) => this.debug(msg, component),
      warn: (msg) => this.warn(msg, component),
      error: (msg, err) => this.error(msg, err, component),
    };
  }
}

// Create singleton logger instance
let loggerInstance = null;

/**
 * Get or create logger instance
 */
export function getLogger(config = {}) {
  if (!loggerInstance) {
    loggerInstance = new Logger(config);
  }
  return loggerInstance;
}

/**
 * Initialize logger with custom config
 */
export function initLogger(config) {
  loggerInstance = new Logger(config);
  return loggerInstance;
}

export default getLogger;
