import { RateLimiterMemory } from 'rate-limiter-flexible';
import { UserSession } from '../types';
import config from '../config/config';
import logger from './logger';

export class RateLimitService {
  private rateLimiters: {
    perMinute: RateLimiterMemory;
    perHour: RateLimiterMemory;
    perDay: RateLimiterMemory;
  };
  
  private userSessions: Map<number, UserSession> = new Map();

  constructor() {
    this.rateLimiters = {
      perMinute: new RateLimiterMemory({
        points: config.bot.rateLimits.perMinute,
        duration: 60, // 60 seconds
      }),
      perHour: new RateLimiterMemory({
        points: config.bot.rateLimits.perHour,
        duration: 3600, // 3600 seconds (1 hour)
      }),
      perDay: new RateLimiterMemory({
        points: config.bot.rateLimits.perDay,
        duration: 86400, // 86400 seconds (24 hours)
      })
    };

    // Clean up old sessions every hour
    setInterval(() => this.cleanupOldSessions(), 3600000);
  }

  /**
   * Check if user is rate limited
   */
  async checkRateLimit(chatId: number): Promise<{ allowed: boolean; retryAfter?: number; reason?: string }> {
    try {
      const userKey = chatId.toString();

      // Check per-minute limit
      const minuteRes = await this.rateLimiters.perMinute.get(userKey);
      if (minuteRes && minuteRes.remainingPoints <= 0) {
        logger.logRateLimit(chatId, 'per-minute', minuteRes.remainingPoints);
        return {
          allowed: false,
          retryAfter: Math.round(minuteRes.msBeforeNext / 1000),
          reason: 'Too many requests per minute'
        };
      }

      // Check per-hour limit
      const hourRes = await this.rateLimiters.perHour.get(userKey);
      if (hourRes && hourRes.remainingPoints <= 0) {
        logger.logRateLimit(chatId, 'per-hour', hourRes.remainingPoints);
        return {
          allowed: false,
          retryAfter: Math.round(hourRes.msBeforeNext / 1000),
          reason: 'Too many requests per hour'
        };
      }

      // Check per-day limit
      const dayRes = await this.rateLimiters.perDay.get(userKey);
      if (dayRes && dayRes.remainingPoints <= 0) {
        logger.logRateLimit(chatId, 'per-day', dayRes.remainingPoints);
        return {
          allowed: false,
          retryAfter: Math.round(dayRes.msBeforeNext / 1000),
          reason: 'Daily limit exceeded'
        };
      }

      return { allowed: true };
    } catch (error) {
      logger.error('Rate limit check failed', { chatId, error });
      // In case of error, allow the request (fail open)
      return { allowed: true };
    }
  }

  /**
   * Consume rate limit points for a user
   */
  async consumeRateLimit(chatId: number, points: number = 1): Promise<void> {
    try {
      const userKey = chatId.toString();
      
      await Promise.all([
        this.rateLimiters.perMinute.consume(userKey, points),
        this.rateLimiters.perHour.consume(userKey, points),
        this.rateLimiters.perDay.consume(userKey, points)
      ]);

      // Update user session
      this.updateUserSession(chatId);
      
      logger.debug('Rate limit consumed', { chatId, points });
    } catch (error) {
      logger.error('Failed to consume rate limit', { chatId, points, error });
      throw error;
    }
  }

  /**
   * Get remaining points for a user
   */
  async getRemainingPoints(chatId: number): Promise<{ minute: number; hour: number; day: number }> {
    try {
      const userKey = chatId.toString();
      
      const [minuteRes, hourRes, dayRes] = await Promise.all([
        this.rateLimiters.perMinute.get(userKey),
        this.rateLimiters.perHour.get(userKey),
        this.rateLimiters.perDay.get(userKey)
      ]);

      return {
        minute: minuteRes?.remainingPoints ?? config.bot.rateLimits.perMinute,
        hour: hourRes?.remainingPoints ?? config.bot.rateLimits.perHour,
        day: dayRes?.remainingPoints ?? config.bot.rateLimits.perDay
      };
    } catch (error) {
      logger.error('Failed to get remaining points', { chatId, error });
      return {
        minute: config.bot.rateLimits.perMinute,
        hour: config.bot.rateLimits.perHour,
        day: config.bot.rateLimits.perDay
      };
    }
  }

  /**
   * Check if user is admin (bypasses rate limits)
   */
  isAdmin(chatId: number): boolean {
    return config.bot.adminChatIds.includes(chatId);
  }

  /**
   * Check rate limit with admin bypass
   */
  async checkRateLimitWithAdminBypass(chatId: number): Promise<{ allowed: boolean; retryAfter?: number; reason?: string }> {
    if (this.isAdmin(chatId)) {
      logger.debug('Admin user bypassed rate limit', { chatId });
      return { allowed: true };
    }

    return this.checkRateLimit(chatId);
  }

  /**
   * Get user session
   */
  getUserSession(chatId: number): UserSession | undefined {
    return this.userSessions.get(chatId);
  }

  /**
   * Update user session
   */
  private updateUserSession(chatId: number): void {
    const now = new Date();
    const session = this.userSessions.get(chatId);

    if (session) {
      session.lastActivity = now;
      session.requestCount.minute++;
      session.requestCount.hour++;
      session.requestCount.day++;
    } else {
      this.userSessions.set(chatId, {
        chatId,
        lastActivity: now,
        requestCount: {
          minute: 1,
          hour: 1,
          day: 1
        }
      });
    }
  }

  /**
   * Clean up old sessions
   */
  private cleanupOldSessions(): void {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    
    let cleanedCount = 0;
    for (const [chatId, session] of this.userSessions.entries()) {
      if (session.lastActivity < oneHourAgo) {
        this.userSessions.delete(chatId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug('Cleaned up old sessions', { cleanedCount });
    }
  }

  /**
   * Reset rate limits for a user (admin function)
   */
  async resetUserRateLimit(chatId: number): Promise<void> {
    try {
      const userKey = chatId.toString();
      
      await Promise.all([
        this.rateLimiters.perMinute.delete(userKey),
        this.rateLimiters.perHour.delete(userKey),
        this.rateLimiters.perDay.delete(userKey)
      ]);

      this.userSessions.delete(chatId);
      
      logger.info('Rate limit reset for user', { chatId });
    } catch (error) {
      logger.error('Failed to reset rate limit', { chatId, error });
      throw error;
    }
  }

  /**
   * Get user-friendly rate limit message
   */
  getRateLimitMessage(retryAfter: number, reason: string): string {
    const minutes = Math.ceil(retryAfter / 60);
    const hours = Math.ceil(retryAfter / 3600);
    
    let timeStr: string;
    if (retryAfter < 60) {
      timeStr = `${retryAfter} seconds`;
    } else if (retryAfter < 3600) {
      timeStr = `${minutes} minute${minutes > 1 ? 's' : ''}`;
    } else {
      timeStr = `${hours} hour${hours > 1 ? 's' : ''}`;
    }

    switch (reason) {
      case 'Too many requests per minute':
        return `⏳ Please wait ${timeStr} before sending another request.`;
      case 'Too many requests per hour':
        return `⏳ You've reached the hourly limit. Please wait ${timeStr} before trying again.`;
      case 'Daily limit exceeded':
        return `⏳ You've reached the daily limit. Please wait ${timeStr} before trying again.`;
      default:
        return `⏳ Rate limit exceeded. Please wait ${timeStr} before trying again.`;
    }
  }

  /**
   * Get stats for all users (admin function)
   */
  getStats(): { totalUsers: number; activeUsers: number; averageRequestsPerUser: number } {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    
    const totalUsers = this.userSessions.size;
    const activeUsers = Array.from(this.userSessions.values())
      .filter(session => session.lastActivity > oneHourAgo).length;
    
    const totalRequests = Array.from(this.userSessions.values())
      .reduce((sum, session) => sum + session.requestCount.hour, 0);
    
    const averageRequestsPerUser = totalUsers > 0 ? totalRequests / totalUsers : 0;

    return {
      totalUsers,
      activeUsers,
      averageRequestsPerUser: Math.round(averageRequestsPerUser * 100) / 100
    };
  }
}

// Create and export singleton instance
export const rateLimitService = new RateLimitService();
export default rateLimitService;