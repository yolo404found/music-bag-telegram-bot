import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import { ApiService } from './services/apiService';
import MessageHandler from './handlers/messageHandler';
import rateLimitService from './services/rateLimitService';
import fileService from './services/fileService';
import logger from './services/logger';
import config from './config/config';

export class MusicBot {
  private bot: TelegramBot;
  private apiService: ApiService;
  private messageHandler: MessageHandler;
  private isRunning: boolean = false;

  constructor() {
    // Initialize Telegram bot
    this.bot = new TelegramBot(config.bot.token, { 
      polling: false // We'll start polling manually
    });

    // Initialize API service
    this.apiService = new ApiService(
      config.bot.apiBaseUrl,
      config.getApiTimeout(),
      logger
    );

    // Initialize message handler
    this.messageHandler = new MessageHandler(this.bot, this.apiService);

    this.setupEventHandlers();
  }

  /**
   * Setup bot event handlers
   */
  private setupEventHandlers(): void {
    // Handle text messages
    this.bot.on('message', async (msg) => {
      try {
        if (msg.text) {
          await this.messageHandler.handleMessage(msg as any);
        }
      } catch (error) {
        logger.error('Error handling message', { 
          chatId: msg.chat.id, 
          messageId: msg.message_id,
          error 
        });
      }
    });

    // Handle callback queries (for inline keyboards)
    this.bot.on('callback_query', async (query) => {
      try {
        await this.handleCallbackQuery(query);
      } catch (error) {
        logger.error('Error handling callback query', { 
          queryId: query.id,
          chatId: query.message?.chat.id,
          error 
        });
      }
    });

    // Handle polling errors
    this.bot.on('polling_error', (error) => {
      logger.error('Polling error occurred', { error });
      
      // If it's a critical error, attempt to restart
      if (this.isCriticalError(error)) {
        logger.warn('Critical polling error detected, attempting to restart polling');
        this.restartPolling();
      }
    });

    // Handle webhook errors (if using webhooks)
    this.bot.on('webhook_error', (error) => {
      logger.error('Webhook error occurred', { error });
    });

    logger.info('Bot event handlers setup complete');
  }

  /**
   * Handle callback queries from inline keyboards
   */
  private async handleCallbackQuery(query: TelegramBot.CallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id;
    const data = query.data;

    if (!chatId || !data) {
      await this.bot.answerCallbackQuery(query.id, { text: 'Invalid request' });
      return;
    }

    try {
      // Parse callback data
      const [action, ...params] = data.split('|');

      switch (action) {
        case 'cancel_download':
          await this.handleCancelDownload(query, params[0]);
          break;
        
        case 'retry_download':
          await this.handleRetryDownload(query, params[0]);
          break;
        
        case 'delete_file':
          await this.handleDeleteFile(query, params[0]);
          break;
        
        case 'select_song':
          await this.handleSelectSong(query, params[0]);
          break;
        
        default:
          await this.bot.answerCallbackQuery(query.id, { text: 'Unknown action' });
      }
    } catch (error) {
      logger.error('Error handling callback query', { chatId, data, error });
      await this.bot.answerCallbackQuery(query.id, { text: 'An error occurred' });
    }
  }

  /**
   * Handle cancel download callback
   */
  private async handleCancelDownload(query: TelegramBot.CallbackQuery, jobId: string): Promise<void> {
    // Implementation will be added in async job handling
    await this.bot.answerCallbackQuery(query.id, { text: 'Download cancelled' });
    logger.info('Download cancelled by user', { 
      chatId: query.message?.chat.id, 
      jobId 
    });
  }

  /**
   * Handle retry download callback
   */
  private async handleRetryDownload(query: TelegramBot.CallbackQuery, url: string): Promise<void> {
    const chatId = query.message?.chat.id;
    if (!chatId) return;

    // Check rate limits
    const rateCheck = await rateLimitService.checkRateLimitWithAdminBypass(chatId);
    if (!rateCheck.allowed) {
      const message = rateLimitService.getRateLimitMessage(rateCheck.retryAfter!, rateCheck.reason!);
      await this.bot.answerCallbackQuery(query.id, { text: message });
      return;
    }

    await this.bot.answerCallbackQuery(query.id, { text: 'Retrying download...' });
    
    // Trigger new download
    await this.messageHandler.handleMessage({
      chat: query.message!.chat,
      message_id: query.message!.message_id,
      text: url,
      date: Math.floor(Date.now() / 1000),
      from: query.from
    } as any);
  }

  /**
   * Handle delete file callback
   */
  private async handleDeleteFile(query: TelegramBot.CallbackQuery, fileToken: string): Promise<void> {
    try {
      await fileService.cleanupTempFile(fileToken);
      await this.bot.answerCallbackQuery(query.id, { text: 'File deleted' });
      
      // Edit the message to remove the download link
      if (query.message) {
        try {
          await this.bot.editMessageText(
            '🗑️ File has been deleted.',
            {
              chat_id: query.message.chat.id,
              message_id: query.message.message_id
            }
          );
        } catch (error) {
          // Ignore edit errors (message might be too old)
          logger.debug('Could not edit message after file deletion', { error });
        }
      }
    } catch (error) {
      logger.error('Error deleting file', { fileToken, error });
      await this.bot.answerCallbackQuery(query.id, { text: 'Failed to delete file' });
    }
  }

  /**
   * Handle song selection from search results
   */
  private async handleSelectSong(query: TelegramBot.CallbackQuery, videoId: string): Promise<void> {
    const chatId = query.message?.chat.id;
    if (!chatId) {
      await this.bot.answerCallbackQuery(query.id, { text: 'Invalid request' });
      return;
    }

    // Check rate limits
    const rateCheck = await rateLimitService.checkRateLimitWithAdminBypass(chatId);
    if (!rateCheck.allowed) {
      const message = rateLimitService.getRateLimitMessage(rateCheck.retryAfter!, rateCheck.reason!);
      await this.bot.answerCallbackQuery(query.id, { text: message });
      return;
    }

    await this.bot.answerCallbackQuery(query.id, { text: 'Uploading to Telegram...' });
    
    // Consume rate limit
    await rateLimitService.consumeRateLimit(chatId);
    
    // Convert videoId to YouTube URL
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    // No processing message needed - start download silently
    // Search results remain preserved for the user
    
    // Trigger download using the message handler
    await this.messageHandler.handleMessage({
      chat: query.message!.chat,
      message_id: query.message!.message_id,
      text: youtubeUrl,
      date: Math.floor(Date.now() / 1000),
      from: query.from
    } as any);
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    try {
      logger.info('Starting Music Bot...');

      // Check API health
      const apiHealthy = await this.apiService.healthCheck();
      if (!apiHealthy) {
        logger.warn('API service is not responding, but starting bot anyway');
      }

      // Start polling or webhook based on configuration
      const webhookUrl = config.getWebhookUrl();
      
      if (webhookUrl && config.isProduction()) {
        await this.startWebhook(webhookUrl);
      } else {
        await this.startPolling();
      }

      this.isRunning = true;
      logger.info('Music Bot started successfully', {
        mode: webhookUrl && config.isProduction() ? 'webhook' : 'polling',
        apiHealth: apiHealthy
      });

      // Set bot commands
      await this.setBotCommands();

    } catch (error) {
      logger.error('Failed to start bot', { error });
      throw error;
    }
  }

  /**
   * Start polling mode
   */
  private async startPolling(): Promise<void> {
    try {
      await this.bot.startPolling({
        restart: true,
        polling: {
          interval: 1000,
          autoStart: false,
          params: {
            timeout: 30
          }
        }
      });
      
      logger.info('Bot started in polling mode');
    } catch (error) {
      logger.error('Failed to start polling', { error });
      throw error;
    }
  }

  /**
   * Start webhook mode
   */
  private async startWebhook(webhookUrl: string): Promise<void> {
    try {
      const port = config.getPort();
      
      // Set webhook
      await this.bot.setWebHook(`${webhookUrl}/webhook/${config.bot.token}`, {
        secret_token: config.bot.webhookSecret
      });

      // Start express server for webhook
      const express = require('express');
      const app = express();
      
      app.use(express.json());
      
      app.post(`/webhook/${config.bot.token}`, (req: express.Request, res: express.Response) => {
        this.bot.processUpdate(req.body);
        res.sendStatus(200);
      });

      app.listen(port, () => {
        logger.info('Webhook server started', { port, webhookUrl });
      });

    } catch (error) {
      logger.error('Failed to start webhook', { error });
      throw error;
    }
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping Music Bot...');

      this.isRunning = false;

      // Stop polling
      await this.bot.stopPolling();

      // Clean up temporary files
      await fileService.emergencyCleanup();

      logger.info('Music Bot stopped successfully');
    } catch (error) {
      logger.error('Error stopping bot', { error });
      throw error;
    }
  }

  /**
   * Restart polling (for error recovery)
   */
  private async restartPolling(): Promise<void> {
    try {
      logger.info('Restarting bot polling...');
      
      await this.bot.stopPolling();
      
      // Wait a bit before restarting
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      await this.startPolling();
      
      logger.info('Bot polling restarted successfully');
    } catch (error) {
      logger.error('Failed to restart polling', { error });
    }
  }

  /**
   * Set bot commands for the menu
   */
  private async setBotCommands(): Promise<void> {
    try {
      const commands = [
        { command: 'start', description: 'Start the bot and see welcome message' },
        { command: 'help', description: 'Show help and usage instructions' },
        { command: 'status', description: 'Check bot and API status' },
        { command: 'limits', description: 'Check your rate limits' }
      ];

      await this.bot.setMyCommands(commands);
      logger.debug('Bot commands set successfully');
    } catch (error) {
      logger.warn('Failed to set bot commands', { error });
    }
  }

  /**
   * Check if error is critical and requires restart
   */
  private isCriticalError(error: any): boolean {
    const criticalCodes = [
      'EFAULT',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND'
    ];

    return criticalCodes.some(code => 
      error.code === code || 
      error.message?.includes(code) ||
      error.toString().includes(code)
    );
  }

  /**
   * Get bot status
   */
  getStatus(): { running: boolean; apiHealthy: boolean } {
    return {
      running: this.isRunning,
      apiHealthy: false // Will be updated with actual health check
    };
  }

  /**
   * Health check endpoint (for monitoring)
   */
  async healthCheck(): Promise<{ bot: boolean; api: boolean; files: number }> {
    try {
      const apiHealthy = await this.apiService.healthCheck();
      const fileStats = await fileService.getStorageStats();
      
      return {
        bot: this.isRunning,
        api: apiHealthy,
        files: fileStats.totalFiles
      };
    } catch (error) {
      logger.error('Health check failed', { error });
      return {
        bot: this.isRunning,
        api: false,
        files: 0
      };
    }
  }
}

export default MusicBot;