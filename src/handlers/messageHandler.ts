import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../types';
import { UrlValidator } from '../utils/urlValidator';
import { ApiService } from '../services/apiService';
import DownloadHandler from './downloadHandler';
import AsyncJobHandler from './asyncJobHandler';
import rateLimitService from '../services/rateLimitService';
import logger from '../services/logger';
import config from '../config/config';

export class MessageHandler {
  private bot: TelegramBot;
  private apiService: ApiService;
  private downloadHandler: DownloadHandler;
  private asyncJobHandler: AsyncJobHandler;

  constructor(bot: TelegramBot, apiService: ApiService) {
    this.bot = bot;
    this.apiService = apiService;
    this.downloadHandler = new DownloadHandler(bot, apiService);
    this.asyncJobHandler = new AsyncJobHandler(bot, apiService);
  }

  /**
   * Handle incoming text messages
   */
  async handleMessage(msg: ExtendedMessage): Promise<void> {
    const chatId = msg.chat.id;
    const messageText = msg.text || '';
    const userId = msg.from?.id;

    try {
      logger.logUserAction(chatId, 'message_received', { 
        text: messageText.substring(0, 100),
        userId,
        username: msg.from?.username 
      });

      // Check rate limits
      const rateCheck = await rateLimitService.checkRateLimitWithAdminBypass(chatId);
      if (!rateCheck.allowed) {
        const message = rateLimitService.getRateLimitMessage(rateCheck.retryAfter!, rateCheck.reason!);
        await this.sendMessage(chatId, message);
        return;
      }

      // Handle commands
      if (messageText.startsWith('/')) {
        await this.handleCommand(chatId, messageText, msg);
        return;
      }

      // Look for YouTube URLs in the message
      const youtubeUrl = UrlValidator.findValidYouTubeUrl(messageText);
      
      if (youtubeUrl) {
        // Consume rate limit
        await rateLimitService.consumeRateLimit(chatId);
        
        // Process the YouTube URL
        await this.processYouTubeUrl(chatId, youtubeUrl, msg);
      } else {
        // Send help message for invalid input
        await this.sendHelpMessage(chatId);
      }

    } catch (error) {
      logger.error('Error handling message', { chatId, error });
      await this.sendErrorMessage(chatId, 'An unexpected error occurred. Please try again.');
    }
  }

  /**
   * Handle bot commands
   */
  private async handleCommand(chatId: number, command: string, msg: ExtendedMessage): Promise<void> {
    const [cmd, ...args] = command.split(' ');

    switch (cmd.toLowerCase()) {
      case '/start':
        await this.handleStartCommand(chatId, msg);
        break;
      
      case '/help':
        await this.handleHelpCommand(chatId);
        break;
      
      case '/status':
        await this.handleStatusCommand(chatId);
        break;
      
      case '/limits':
        await this.handleLimitsCommand(chatId);
        break;
      
      case '/stats':
        if (rateLimitService.isAdmin(chatId)) {
          await this.handleStatsCommand(chatId);
        } else {
          await this.sendMessage(chatId, '❌ This command is only available to administrators.');
        }
        break;
      
      case '/reset':
        if (rateLimitService.isAdmin(chatId)) {
          await this.handleResetCommand(chatId, args);
        } else {
          await this.sendMessage(chatId, '❌ This command is only available to administrators.');
        }
        break;
      
      default:
        await this.sendMessage(chatId, '❓ Unknown command. Type /help to see available commands.');
    }
  }

  /**
   * Process YouTube URL
   */
  private async processYouTubeUrl(chatId: number, url: string, _msg: ExtendedMessage): Promise<void> {
    let statusMessage: TelegramBot.Message | undefined;

    try {
      // Send initial status message
      statusMessage = await this.sendMessage(chatId, '🔍 Checking your link...');

      // Validate URL
      const validation = UrlValidator.validateUrl(url);
      if (!validation.valid) {
        const errorMsg = UrlValidator.getValidationErrorMessage(validation.reason!);
        await this.editMessage(chatId, statusMessage.message_id, errorMsg);
        return;
      }

      // Check URL with API
      const checkResult = await this.apiService.checkUrl(url);
      
      if (!checkResult.canDownload) {
        const reason = this.getCannotDownloadReason(checkResult);
        await this.editMessage(chatId, statusMessage.message_id, reason);
        return;
      }

      // Send video information
      const infoText = this.formatVideoInfo(checkResult);
      await this.editMessage(chatId, statusMessage.message_id, infoText);

      // Check if sync or async processing
      if (checkResult.recommendedProcessing === 'sync') {
        await this.processSyncDownload(chatId, url, checkResult, statusMessage.message_id);
      } else {
        await this.processAsyncDownload(chatId, url, checkResult, statusMessage.message_id);
      }

    } catch (error) {
      logger.error('Error processing YouTube URL', { chatId, url, error });
      
      if (statusMessage) {
        await this.editMessage(
          chatId, 
          statusMessage.message_id, 
          ApiService.getUserErrorMessage(error as any)
        );
      } else {
        await this.sendErrorMessage(chatId, ApiService.getUserErrorMessage(error as any));
      }
    }
  }

  /**
   * Process synchronous download
   */
  private async processSyncDownload(
    chatId: number, 
    url: string, 
    videoInfo: any, 
    messageId: number
  ): Promise<void> {
    await this.downloadHandler.processSyncDownload(chatId, url, videoInfo, messageId);
  }

  /**
   * Process asynchronous download
   */
  private async processAsyncDownload(
    chatId: number, 
    url: string, 
    videoInfo: any, 
    messageId: number
  ): Promise<void> {
    await this.asyncJobHandler.processAsyncDownload(chatId, url, videoInfo, messageId);
  }

  /**
   * Handle /start command
   */
  private async handleStartCommand(chatId: number, msg: ExtendedMessage): Promise<void> {
    const username = msg.from?.first_name || 'there';
    const welcomeText = `
🎵 Welcome to Music Bag Bot, ${username}!

I can help you download YouTube videos as MP3 files.

📝 **How to use:**
• Send me any YouTube URL
• I'll check if it can be downloaded
• You'll receive the MP3 file or a download link

⚠️ **Important:**
• Only YouTube URLs are supported
• Copyright-protected content may not be downloadable
• Large files will be provided as download links

Type /help for more information or send me a YouTube URL to get started!
    `.trim();

    await this.sendMessage(chatId, welcomeText);
  }

  /**
   * Handle /help command
   */
  private async handleHelpCommand(chatId: number): Promise<void> {
    const helpText = `
🤖 **Music Bag Bot Help**

**Commands:**
/start - Show welcome message
/help - Show this help message
/status - Check bot status
/limits - Show your rate limits

**Usage:**
1. Send me a YouTube URL (youtube.com or youtu.be)
2. I'll check if the video can be downloaded
3. You'll receive the MP3 file directly or a download link

**Supported URLs:**
✅ https://www.youtube.com/watch?v=VIDEO_ID
✅ https://youtu.be/VIDEO_ID
✅ https://m.youtube.com/watch?v=VIDEO_ID

**Limitations:**
• ${config.bot.rateLimits.perMinute} requests per minute
• ${config.bot.rateLimits.perHour} requests per hour
• ${config.bot.rateLimits.perDay} requests per day
• Files larger than ${config.bot.maxUploadMB}MB will be provided as download links
• Copyright-protected content cannot be downloaded

**File Size:**
• Small files (≤${config.bot.maxUploadMB}MB): Sent directly to chat
• Large files (>${config.bot.maxUploadMB}MB): Download link provided (expires in ${Math.round(config.bot.tmpTtlSeconds/3600)} hour${Math.round(config.bot.tmpTtlSeconds/3600) !== 1 ? 's' : ''})

Need help? Contact support or check our documentation.
    `.trim();

    await this.sendMessage(chatId, helpText);
  }

  /**
   * Handle /status command
   */
  private async handleStatusCommand(chatId: number): Promise<void> {
    try {
      const apiHealthy = await this.apiService.healthCheck();
      const remaining = await rateLimitService.getRemainingPoints(chatId);
      
      const statusText = `
🤖 **Bot Status**

**API Service:** ${apiHealthy ? '✅ Online' : '❌ Offline'}
**Your Rate Limits:**
• Per minute: ${remaining.minute}/${config.bot.rateLimits.perMinute}
• Per hour: ${remaining.hour}/${config.bot.rateLimits.perHour}
• Per day: ${remaining.day}/${config.bot.rateLimits.perDay}

**Configuration:**
• Max file size: ${config.bot.maxUploadMB}MB
• File TTL: ${Math.round(config.bot.tmpTtlSeconds/3600)} hours
• Environment: ${config.isProduction() ? 'Production' : 'Development'}
      `.trim();

      await this.sendMessage(chatId, statusText);
    } catch (error) {
      logger.error('Error checking status', { chatId, error });
      await this.sendErrorMessage(chatId, 'Unable to check status at the moment.');
    }
  }

  /**
   * Handle /limits command
   */
  private async handleLimitsCommand(chatId: number): Promise<void> {
    try {
      const remaining = await rateLimitService.getRemainingPoints(chatId);
      const isAdmin = rateLimitService.isAdmin(chatId);
      
      const limitsText = `
⏳ **Your Rate Limits**

**Remaining requests:**
• This minute: ${remaining.minute}/${config.bot.rateLimits.perMinute}
• This hour: ${remaining.hour}/${config.bot.rateLimits.perHour}
• Today: ${remaining.day}/${config.bot.rateLimits.perDay}

${isAdmin ? '👑 **Admin Status:** Rate limits bypassed' : ''}

**Note:** Rate limits reset automatically. If you exceed limits, you'll need to wait before making more requests.
      `.trim();

      await this.sendMessage(chatId, limitsText);
    } catch (error) {
      logger.error('Error checking limits', { chatId, error });
      await this.sendErrorMessage(chatId, 'Unable to check limits at the moment.');
    }
  }

  /**
   * Handle /stats command (admin only)
   */
  private async handleStatsCommand(chatId: number): Promise<void> {
    try {
      const rateLimitStats = rateLimitService.getStats();
      // File stats will be added when file service is implemented
      
      const statsText = `
📊 **Bot Statistics**

**Users:**
• Total users: ${rateLimitStats.totalUsers}
• Active users (last hour): ${rateLimitStats.activeUsers}
• Average requests per user: ${rateLimitStats.averageRequestsPerUser}

**System:**
• Environment: ${config.isProduction() ? 'Production' : 'Development'}
• Debug enabled: ${config.isDebugEnabled() ? 'Yes' : 'No'}
      `.trim();

      await this.sendMessage(chatId, statsText);
    } catch (error) {
      logger.error('Error getting stats', { chatId, error });
      await this.sendErrorMessage(chatId, 'Unable to get statistics at the moment.');
    }
  }

  /**
   * Handle /reset command (admin only)
   */
  private async handleResetCommand(chatId: number, args: string[]): Promise<void> {
    if (args.length === 0) {
      await this.sendMessage(chatId, '❌ Usage: /reset <user_chat_id>');
      return;
    }

    const targetChatId = parseInt(args[0]);
    if (isNaN(targetChatId)) {
      await this.sendMessage(chatId, '❌ Invalid chat ID. Please provide a numeric chat ID.');
      return;
    }

    try {
      await rateLimitService.resetUserRateLimit(targetChatId);
      await this.sendMessage(chatId, `✅ Rate limits reset for user ${targetChatId}.`);
      
      logger.info('Admin reset user rate limits', { adminChatId: chatId, targetChatId });
    } catch (error) {
      logger.error('Error resetting user rate limits', { chatId, targetChatId, error });
      await this.sendErrorMessage(chatId, 'Failed to reset rate limits.');
    }
  }

  /**
   * Send help message for invalid input
   */
  private async sendHelpMessage(chatId: number): Promise<void> {
    const helpText = `
❓ **Please send me a YouTube URL**

**Supported formats:**
• https://www.youtube.com/watch?v=VIDEO_ID
• https://youtu.be/VIDEO_ID
• https://m.youtube.com/watch?v=VIDEO_ID

Or type /help for more information.
    `.trim();

    await this.sendMessage(chatId, helpText);
  }

  /**
   * Format video information
   */
  private formatVideoInfo(videoInfo: any): string {
    const duration = this.formatDuration(videoInfo.durationSec);
    const license = videoInfo.license === 'creativeCommon' ? 'Creative Commons' : 'Standard';
    
    return `
🎵 **Video Information**

**Title:** ${videoInfo.title}
**Duration:** ${duration}
**License:** ${license}
**Provider:** ${videoInfo.provider}
${videoInfo.isLive ? '🔴 **Live Stream**' : ''}

🔄 **Preparing download...**
    `.trim();
  }

  /**
   * Format duration from seconds
   */
  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  }

  /**
   * Get reason why video cannot be downloaded
   */
  private getCannotDownloadReason(videoInfo: any): string {
    if (videoInfo.isLive) {
      return '🔴 Cannot download live streams. Please try again when the stream has ended.';
    }
    
    if (videoInfo.license === 'standard') {
      return '🚫 This video cannot be downloaded due to copyright restrictions.';
    }
    
    return '🚫 This video cannot be downloaded due to restrictions.';
  }

  /**
   * Send message wrapper with error handling
   */
  private async sendMessage(chatId: number, text: string, options?: TelegramBot.SendMessageOptions): Promise<TelegramBot.Message> {
    try {
      return await this.bot.sendMessage(chatId, text, options);
    } catch (error) {
      logger.error('Failed to send message', { chatId, error });
      throw error;
    }
  }

  /**
   * Edit message wrapper with error handling
   */
  private async editMessage(chatId: number, messageId: number, text: string, options?: TelegramBot.EditMessageTextOptions): Promise<TelegramBot.Message | boolean> {
    try {
      return await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...options
      });
    } catch (error) {
      logger.error('Failed to edit message', { chatId, messageId, error });
      // If edit fails, try sending a new message
      return await this.sendMessage(chatId, text);
    }
  }

  /**
   * Send error message
   */
  private async sendErrorMessage(chatId: number, message: string): Promise<void> {
    try {
      await this.sendMessage(chatId, `❌ ${message}`);
    } catch (error) {
      logger.error('Failed to send error message', { chatId, message, error });
    }
  }
}

export default MessageHandler;