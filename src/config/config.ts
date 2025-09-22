import dotenv from 'dotenv';
import { BotConfig, LogConfig, SecurityConfig } from '../types';

// Load environment variables
dotenv.config();

export class Config {
  private static instance: Config;
  public readonly bot: BotConfig;
  public readonly log: LogConfig;
  public readonly security: SecurityConfig;

  private constructor() {
    this.validateRequiredEnvVars();
    
    this.bot = {
      token: process.env.TELEGRAM_BOT_TOKEN!,
      apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
      tmpDir: process.env.TMP_DIR || './tmp',
      maxUploadMB: parseInt(process.env.MAX_UPLOAD_MB || '50'),
      tmpTtlSeconds: parseInt(process.env.TMP_TTL_SECONDS || '3600'),
      rateLimits: {
        perMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE || '5'),
        perHour: parseInt(process.env.RATE_LIMIT_PER_HOUR || '50'),
        perDay: parseInt(process.env.RATE_LIMIT_PER_DAY || '200')
      },
      ...(process.env.WEBHOOK_SECRET && { webhookSecret: process.env.WEBHOOK_SECRET }),
      adminChatIds: this.parseAdminChatIds()
    };

    this.log = {
      level: process.env.LOG_LEVEL || 'info',
      file: process.env.LOG_FILE || './logs/bot.log',
      console: process.env.NODE_ENV !== 'production'
    };

    this.security = {
      maxFileSize: this.bot.maxUploadMB * 1024 * 1024, // Convert to bytes
      allowedDomains: this.parseAllowedDomains(),
      blockedPatterns: this.parseBlockedPatterns(),
      requiresAuth: process.env.REQUIRES_AUTH === 'true'
    };
  }

  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  private validateRequiredEnvVars(): void {
    const required = ['TELEGRAM_BOT_TOKEN'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  private parseAdminChatIds(): number[] {
    const adminIds = process.env.ADMIN_CHAT_IDS;
    if (!adminIds) return [];
    
    return adminIds.split(',')
      .map(id => parseInt(id.trim()))
      .filter(id => !isNaN(id));
  }

  private parseAllowedDomains(): string[] {
    const domains = process.env.ALLOWED_DOMAINS;
    if (!domains) return ['youtube.com', 'youtu.be', 'm.youtube.com'];
    
    return domains.split(',').map(domain => domain.trim());
  }

  private parseBlockedPatterns(): string[] {
    const patterns = process.env.BLOCKED_PATTERNS;
    if (!patterns) return [];
    
    return patterns.split(',').map(pattern => pattern.trim());
  }

  public isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  public isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development';
  }

  public getPort(): number {
    return parseInt(process.env.PORT || '8080');
  }

  public getWebhookUrl(): string | undefined {
    return process.env.WEBHOOK_URL;
  }

  public getApiTimeout(): number {
    return parseInt(process.env.API_TIMEOUT || '300000');
  }

  public isDebugEnabled(): boolean {
    return process.env.DEBUG === 'true' || this.isDevelopment();
  }
}

export default Config.getInstance();