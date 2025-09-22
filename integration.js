#!/usr/bin/env node

/**
 * Music Bot Telegram - Integration with Main Bot
 * 
 * This script integrates the Telegram bot with the main bot system
 * and provides a unified interface for the Music Bag application.
 */

const MusicBot = require('./dist/bot').default;
const logger = require('./dist/services/logger').default;

class MusicBotIntegration {
  constructor() {
    this.telegramBot = null;
    this.isRunning = false;
  }

  /**
   * Initialize and start the Telegram bot
   */
  async start() {
    try {
      logger.info('Starting Music Bot Telegram Integration');

      // Create bot instance
      this.telegramBot = new MusicBot();

      // Start the bot
      await this.telegramBot.start();

      this.isRunning = true;
      logger.info('Music Bot Telegram Integration started successfully');

      return {
        success: true,
        message: 'Telegram bot started successfully'
      };

    } catch (error) {
      logger.error('Failed to start Telegram bot integration', { error });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Stop the Telegram bot
   */
  async stop() {
    try {
      if (this.telegramBot && this.isRunning) {
        await this.telegramBot.stop();
        this.isRunning = false;
        logger.info('Music Bot Telegram Integration stopped');
      }

      return {
        success: true,
        message: 'Telegram bot stopped successfully'
      };

    } catch (error) {
      logger.error('Error stopping Telegram bot', { error });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get bot status
   */
  async getStatus() {
    try {
      if (!this.telegramBot) {
        return {
          running: false,
          message: 'Bot not initialized'
        };
      }

      const health = await this.telegramBot.healthCheck();
      
      return {
        running: this.isRunning,
        health,
        message: this.isRunning ? 'Bot is running' : 'Bot is stopped'
      };

    } catch (error) {
      logger.error('Error getting bot status', { error });
      return {
        running: false,
        error: error.message
      };
    }
  }

  /**
   * Restart the bot
   */
  async restart() {
    logger.info('Restarting Telegram bot...');
    
    const stopResult = await this.stop();
    if (!stopResult.success) {
      return stopResult;
    }

    // Wait a moment before restarting
    await new Promise(resolve => setTimeout(resolve, 2000));

    return await this.start();
  }
}

// Export for integration with main application
module.exports = MusicBotIntegration;

// If called directly, start the bot
if (require.main === module) {
  const integration = new MusicBotIntegration();
  
  // Start the bot
  integration.start().then(result => {
    if (result.success) {
      console.log('✅ Telegram bot started successfully');
      
      // Set up graceful shutdown
      process.on('SIGTERM', async () => {
        console.log('Received SIGTERM, shutting down...');
        await integration.stop();
        process.exit(0);
      });

      process.on('SIGINT', async () => {
        console.log('Received SIGINT, shutting down...');
        await integration.stop();
        process.exit(0);
      });

    } else {
      console.error('❌ Failed to start Telegram bot:', result.error);
      process.exit(1);
    }
  }).catch(error => {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  });
}