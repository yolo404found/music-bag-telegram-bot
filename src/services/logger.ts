import winston from 'winston';
import path from 'path';
import fs from 'fs-extra';
import { Logger } from '../types';
import config from '../config/config';

export class LoggerService implements Logger {
  private logger: winston.Logger;

  constructor() {
    this.ensureLogDirectory();
    this.logger = this.createLogger();
  }

  private ensureLogDirectory(): void {
    const logDir = path.dirname(config.log.file);
    fs.ensureDirSync(logDir);
  }

  private createLogger(): winston.Logger {
    const logFormat = winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
      }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    );

    const consoleFormat = winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} [${level}]: ${message}${metaStr}`;
      })
    );

    const transports: winston.transport[] = [
      new winston.transports.File({
        filename: config.log.file,
        level: config.log.level,
        format: logFormat,
        maxsize: 5242880, // 5MB
        maxFiles: 5,
        tailable: true
      })
    ];

    if (config.log.console) {
      transports.push(
        new winston.transports.Console({
          level: config.isDebugEnabled() ? 'debug' : config.log.level,
          format: consoleFormat
        })
      );
    }

    return winston.createLogger({
      level: config.log.level,
      format: logFormat,
      transports,
      exceptionHandlers: [
        new winston.transports.File({ filename: path.join(path.dirname(config.log.file), 'exceptions.log') })
      ],
      rejectionHandlers: [
        new winston.transports.File({ filename: path.join(path.dirname(config.log.file), 'rejections.log') })
      ]
    });
  }

  info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  warn(message: string, meta?: any): void {
    const safeMeta = meta ? this.sanitizeForLogging(meta) : undefined;
    this.logger.warn(message, safeMeta);
  }

  error(message: string, meta?: any): void {
    const safeMeta = meta ? this.sanitizeForLogging(meta) : undefined;
    this.logger.error(message, safeMeta);
  }

  debug(message: string, meta?: any): void {
    const safeMeta = meta ? this.sanitizeForLogging(meta) : undefined;
    this.logger.debug(message, safeMeta);
  }

  // Additional methods for Telegram bot specific logging
  logUserAction(chatId: number, action: string, data?: any): void {
    this.info(`User Action: ${action}`, { chatId, ...data });
  }

  logApiCall(endpoint: string, duration: number, success: boolean, error?: any): void {
    if (success) {
      this.info(`API Call: ${endpoint}`, { duration, success });
    } else {
      this.error(`API Call Failed: ${endpoint}`, { duration, success, error });
    }
  }

  logDownload(chatId: number, url: string, status: string, fileSize?: number, duration?: number): void {
    this.info(`Download: ${status}`, { chatId, url, fileSize, duration });
  }

  logRateLimit(chatId: number, action: string, remainingRequests: number): void {
    this.warn(`Rate Limit Check: ${action}`, { chatId, remainingRequests });
  }

  logError(error: Error, context?: any): void {
    // Safely extract context to avoid circular references
    const safeContext = context ? this.sanitizeForLogging(context) : {};
    
    this.error(`Error: ${error.message}`, { 
      stack: error.stack,
      name: error.name,
      ...safeContext
    });
  }

  /**
   * Sanitize objects for logging to avoid circular references
   */
  private sanitizeForLogging(obj: any, depth: number = 0, maxDepth: number = 3): any {
    // Prevent infinite recursion
    if (depth > maxDepth) {
      return '[Max Depth Reached]';
    }

    try {
      if (obj === null || obj === undefined) {
        return obj;
      }

      // Handle primitive types
      if (typeof obj !== 'object') {
        return obj;
      }

      // Handle arrays
      if (Array.isArray(obj)) {
        return obj.map(item => this.sanitizeForLogging(item, depth + 1, maxDepth));
      }

      // Handle specific problematic objects
      if (obj.constructor && obj.constructor.name === 'Socket') {
        return '[Socket Object]';
      }
      if (obj.constructor && obj.constructor.name === 'HTTPParser') {
        return '[HTTPParser Object]';
      }
      if (obj.constructor && obj.constructor.name === 'IncomingMessage') {
        return '[IncomingMessage Object]';
      }

      // For regular objects, extract safe properties
      const safe: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          try {
            const value = obj[key];
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
              safe[key] = value;
            } else if (value === null || value === undefined) {
              safe[key] = value;
            } else if (typeof value === 'object') {
              // Recursively sanitize nested objects
              safe[key] = this.sanitizeForLogging(value, depth + 1, maxDepth);
            } else {
              safe[key] = '[Complex Value]';
            }
          } catch (keyError) {
            safe[key] = '[Error Accessing Property]';
          }
        }
      }
      return safe;
    } catch (error) {
      return '[Serialization Error]';
    }
  }

  logSecurity(event: string, chatId?: number, details?: any): void {
    this.warn(`Security Event: ${event}`, { chatId, ...details });
  }
}

// Create and export singleton instance
export const logger = new LoggerService();
export default logger;