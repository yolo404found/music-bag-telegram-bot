import MusicBot from './bot';
import logger from './services/logger';
import config from './config/config';

// Global error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
  process.exit(1);
});

// Graceful shutdown handlers
const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully`);
  
  if (bot) {
    bot.stop().then(() => {
      logger.info('Bot stopped, exiting process');
      process.exit(0);
    }).catch((error) => {
      logger.error('Error during shutdown', { error });
      process.exit(1);
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Main function
async function main() {
  try {
    logger.info('Starting Music Bot Telegram application');
    logger.info('Configuration loaded', {
      environment: config.isProduction() ? 'production' : 'development',
      apiBaseUrl: config.bot.apiBaseUrl,
      maxUploadMB: config.bot.maxUploadMB,
      rateLimits: config.bot.rateLimits
    });

    // Create and start bot
    const bot = new MusicBot();
    await bot.start();

    logger.info('Music Bot is now running');

    // Keep the process alive
    const keepAlive = () => {
      setInterval(() => {
        // Perform health checks or maintenance tasks
        bot.healthCheck().then((health) => {
          if (!health.bot || !health.api) {
            logger.warn('Health check failed', health);
          }
        }).catch((error) => {
          logger.error('Health check error', { error });
        });
      }, 60000); // Check every minute
    };

    keepAlive();

  } catch (error) {
    logger.error('Failed to start application', { error });
    process.exit(1);
  }
}

// Global bot instance for shutdown handler
let bot: MusicBot | null = null;

// Start the application
if (require.main === module) {
  main().catch((error) => {
    logger.error('Application startup failed', { error });
    process.exit(1);
  });
}

export { MusicBot };
export default main;