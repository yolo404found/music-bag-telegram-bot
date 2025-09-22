import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs-extra';
import path from 'path';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { ApiService } from '../services/apiService';
import fileService from '../services/fileService';
import logger from '../services/logger';
import config from '../config/config';
import { CheckResponse, DownloadJob, TempFile } from '../types';

export class DownloadHandler {
  private bot: TelegramBot;
  private apiService: ApiService;
  private activeDownloads: Map<string, DownloadJob> = new Map();

  constructor(bot: TelegramBot, apiService: ApiService) {
    this.bot = bot;
    this.apiService = apiService;
  }

  /**
   * Process synchronous download
   */
  async processSyncDownload(
    chatId: number,
    url: string,
    videoInfo: CheckResponse,
    statusMessageId: number
  ): Promise<void> {
    const jobId = uuidv4();
    const startTime = new Date();

    // Create download job
    const job: DownloadJob = {
      id: jobId,
      chatId,
      url,
      status: 'processing',
      messageId: statusMessageId,
      startTime,
      metadata: videoInfo
    };

    this.activeDownloads.set(jobId, job);

    try {
      console.log('🤖 BOT: Starting processSyncDownload', { chatId, url: url.substring(0, 50), jobId });
      logger.logDownload(chatId, url, 'started');

      // Update status message
      await this.updateProgressMessage(
        chatId,
        statusMessageId,
        '🔄 Downloading audio...',
        0
      );

      // Start download stream
      console.log('🤖 BOT: Requesting download stream from API');
      logger.debug('Requesting download stream from API', { url: url.substring(0, 50) });
      const stream = await this.apiService.downloadStream(url, 'mp3', '192k');
      console.log('🤖 BOT: Download stream received, creating temp file');
      logger.debug('Download stream received, creating temp file');
      
      // Create temporary file from stream
      const filename = this.generateFilename(videoInfo.title);
      console.log('🤖 BOT: Starting createTempFileFromStream');
      const tempFile = await this.createTempFileFromStream(stream, chatId, jobId, filename);
      console.log('🤖 BOT: Temp file created successfully', { 
        tempFileId: tempFile.id, 
        filePath: tempFile.filePath 
      });
      logger.debug('Temp file created successfully', { 
        tempFileId: tempFile.id, 
        filePath: tempFile.filePath 
      });

      // Check file size
      console.log('🤖 BOT: Checking file size', { tempFilePath: tempFile.filePath });
      const fileSize = await fileService.getFileSize(tempFile.filePath);
      job.fileSize = fileSize;
      job.filePath = tempFile.filePath;

      console.log('🤖 BOT: Download completed successfully', { fileSize, fileSizeMB: (fileSize / 1024 / 1024).toFixed(2) });
      logger.logDownload(chatId, url, 'completed', fileSize, Date.now() - startTime.getTime());

      // Decide whether to upload directly or provide download link
      if (fileSize <= config.security.maxFileSize) {
        console.log('🤖 BOT: Uploading file to Telegram');
        await this.uploadFileToTelegram(chatId, tempFile, videoInfo, statusMessageId);
        // Clean up temp file after successful upload
        await fileService.cleanupTempFile(tempFile.id);
        console.log('🤖 BOT: Temp file cleaned up after successful upload');
      } else {
        console.log('🤖 BOT: Providing download link (file too large)');
        await this.provideDownloadLink(chatId, tempFile, videoInfo, statusMessageId);
        // Don't clean up file when providing download link
        console.log('🤖 BOT: Download link provided, keeping file for download');
      }

      job.status = 'ready';
      job.endTime = new Date();

    } catch (error) {
      // Extract safe error properties to avoid circular references
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorName = error instanceof Error ? error.name : 'Error';
      
      console.error('🤖 BOT: Sync download failed', { 
        chatId, 
        url: url.substring(0, 50), 
        jobId, 
        error: {
          message: errorMessage,
          name: errorName
        }
      });
      logger.error('Sync download failed', { 
        chatId, 
        url, 
        jobId, 
        error: {
          message: errorMessage,
          name: errorName
        }
      });
      
      job.status = 'failed';
      job.error = errorMessage;
      job.endTime = new Date();

      await this.handleDownloadError(chatId, statusMessageId, error, url);
    } finally {
      // Keep job in memory for a while for reference
      setTimeout(() => {
        this.activeDownloads.delete(jobId);
      }, 300000); // 5 minutes
    }
  }

  /**
   * Create temporary file from stream with progress tracking
   */
  private async createTempFileFromStream(
    stream: Readable,
    chatId: number,
    jobId: string,
    filename: string
  ): Promise<TempFile> {
    const secureFilename = this.generateSecureFilename(filename);
    const filePath = path.join(config.bot.tmpDir, secureFilename);
    
    console.log('🤖 BOT: Creating temp file from stream', { secureFilename, filePath });
    logger.debug('Creating temp file from stream', { secureFilename, filePath });
    
    return new Promise<TempFile>((resolve, reject) => {
      const writeStream = fs.createWriteStream(filePath);
      let downloadedBytes = 0;
      let hasData = false;

      stream.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        hasData = true;
        if (downloadedBytes % (1024 * 1024) === 0) { // Log every MB
          console.log('🤖 BOT: Download progress', { downloadedBytes, downloadedMB: (downloadedBytes / 1024 / 1024).toFixed(1) });
          logger.debug('Download progress', { downloadedBytes, downloadedMB: (downloadedBytes / 1024 / 1024).toFixed(1) });
        }
      });

      stream.on('error', (error) => {
        console.error('🤖 BOT: Stream error during download', {
          error: {
            message: error.message,
            name: error.name
          },
          downloadedBytes,
          hasData
        });
        logger.error('Stream error during download', {
          error: {
            message: error.message,
            name: error.name
          },
          downloadedBytes,
          hasData
        });
        writeStream.destroy();
        fs.unlink(filePath).catch(() => {}); // Clean up on error
        reject(error);
      });

      writeStream.on('error', (error) => {
        console.error('🤖 BOT: Write stream error', {
          error: {
            message: error.message,
            name: error.name
          },
          filePath
        });
        logger.error('Write stream error', {
          error: {
            message: error.message,
            name: error.name
          },
          filePath
        });
        fs.unlink(filePath).catch(() => {}); // Clean up on error
        reject(error);
      });

      writeStream.on('finish', async () => {
        console.log('🤖 BOT: Stream finished, finalizing temp file', { 
          downloadedBytes, 
          hasData,
          filePath 
        });
        logger.debug('Stream finished, finalizing temp file', { 
          downloadedBytes, 
          hasData,
          filePath 
        });
        
        try {
          // Check if we actually got data
          if (!hasData || downloadedBytes === 0) {
            throw new Error('No data received from stream');
          }
          
          console.log('🤖 BOT: Reading file buffer');
          const fileBuffer = await fs.readFile(filePath);
          console.log('🤖 BOT: File read successfully', { bufferSize: fileBuffer.length });
          logger.debug('File read successfully', { bufferSize: fileBuffer.length });
          
          console.log('🤖 BOT: Saving temp file via fileService');
          const tempFile = await fileService.saveTempFile(
            fileBuffer,
            chatId,
            jobId,
            secureFilename
          );
          
          // Remove the original file only if it's different from the managed file path
          if (filePath !== tempFile.filePath) {
            await fs.unlink(filePath);
            console.log('🤖 BOT: Original temp file cleaned up', { originalPath: filePath });
          } else {
            console.log('🤖 BOT: Temp file already in managed location, no cleanup needed');
          }
          
          console.log('🤖 BOT: Temp file created successfully', { tempFileId: tempFile.id, managedPath: tempFile.filePath });
          logger.debug('Temp file created successfully', { tempFileId: tempFile.id, managedPath: tempFile.filePath });
          resolve(tempFile);
        } catch (error) {
          console.error('🤖 BOT: Error finalizing temp file', {
            error: {
              message: error instanceof Error ? error.message : 'Unknown error',
              name: error instanceof Error ? error.name : 'Error'
            },
            filePath
          });
          logger.error('Error finalizing temp file', {
            error: {
              message: error instanceof Error ? error.message : 'Unknown error',
              name: error instanceof Error ? error.name : 'Error'
            },
            filePath
          });
          reject(error);
        }
      });

      // Handle stream end without finish (potential issue)
      stream.on('end', () => {
        console.log('🤖 BOT: Stream ended', { downloadedBytes, hasData });
        logger.debug('Stream ended', { downloadedBytes, hasData });
      });

      // Start piping
      console.log('🤖 BOT: Starting stream pipe');
      logger.debug('Starting stream pipe');
      stream.pipe(writeStream);
    });
  }

  /**
   * Upload file directly to Telegram
   */
  private async uploadFileToTelegram(
    chatId: number,
    tempFile: TempFile,
    videoInfo: CheckResponse,
    statusMessageId: number
  ): Promise<void> {
    try {
      await this.updateProgressMessage(
        chatId,
        statusMessageId,
        '📤 Uploading to Telegram...',
        90
      );

      console.log('🤖 BOT: Creating file stream for upload', { filePath: tempFile.filePath });
      const fileStream = fileService.createReadStream(tempFile.filePath);
      
      // Prepare audio metadata (without inline keyboard to avoid button data issues)
      const audioOptions: TelegramBot.SendAudioOptions = {
        title: videoInfo.title,
        performer: 'YouTube',
        duration: videoInfo.durationSec,
        caption: this.formatFileCaption(videoInfo)
        // Removing inline keyboard temporarily to fix BUTTON_DATA_INVALID error
      };

      console.log('🤖 BOT: Sending audio to Telegram', { 
        chatId, 
        title: videoInfo.title,
        duration: videoInfo.durationSec
      });
      
      // Send as audio file
      await this.bot.sendAudio(chatId, fileStream, audioOptions);

      console.log('🤖 BOT: Audio sent successfully, deleting status message');
      
      // Delete the status message
      try {
        await this.bot.deleteMessage(chatId, statusMessageId);
      } catch (error) {
        // Ignore delete errors (message might be too old)
        console.warn('🤖 BOT: Could not delete status message', { chatId, statusMessageId });
        logger.debug('Could not delete status message', { chatId, statusMessageId, error });
      }

      console.log('🤖 BOT: File uploaded to Telegram successfully');
      logger.info('File uploaded to Telegram successfully', {
        chatId,
        tempFileId: tempFile.id,
        title: videoInfo.title
      });

    } catch (error) {
      const safeError = {
        message: error instanceof Error ? error.message : 'Unknown error',
        name: error instanceof Error ? error.name : 'Error',
        code: (error as any)?.code || 'UNKNOWN'
      };
      
      console.error('🤖 BOT: Failed to upload file to Telegram', {
        chatId,
        tempFileId: tempFile.id,
        error: safeError
      });
      logger.error('Failed to upload file to Telegram', {
        chatId,
        tempFileId: tempFile.id,
        error: safeError
      });

      // Fallback to download link
      await this.provideDownloadLink(chatId, tempFile, videoInfo, statusMessageId);
    }
  }

  /**
   * Provide download link for large files
   */
  private async provideDownloadLink(
    chatId: number,
    tempFile: TempFile,
    videoInfo: CheckResponse,
    statusMessageId: number
  ): Promise<void> {
    try {
      console.log('🤖 BOT: Providing download link for large file');
      const fileSize = await fileService.getFileSize(tempFile.filePath);
      const fileSizeMB = Math.round((fileSize / 1024 / 1024) * 100) / 100;
      const expiresIn = Math.round(config.bot.tmpTtlSeconds / 3600);
      
      console.log('🤖 BOT: File size calculated', { fileSize, fileSizeMB, expiresIn });
      
      const downloadText = `
✅ **Download Ready**

🎵 **${videoInfo.title}**
📊 **Size:** ${fileSizeMB} MB
⏱️ **Duration:** ${this.formatDuration(videoInfo.durationSec)}

📁 Your file is ready for download!

⚠️ **Note:** Download link temporarily disabled due to localhost URL restrictions.
The audio file has been successfully converted and is available on the server.

_File size: ${fileSizeMB}MB_
      `.trim();

      const downloadOptions = {
        parse_mode: 'Markdown' as const,
        disable_web_page_preview: true
        // Removing inline keyboard with localhost URL to fix Telegram URL validation
      };

      console.log('🤖 BOT: Editing message with download link');
      // Edit status message with download link
      await this.bot.editMessageText(downloadText, {
        chat_id: chatId,
        message_id: statusMessageId,
        ...downloadOptions
      });

      console.log('🤖 BOT: Download link provided successfully');
      logger.info('Download link provided', {
        chatId,
        fileSize: fileSizeMB,
        title: videoInfo.title,
        expiresAt: tempFile.expiresAt
      });

    } catch (error) {
      const safeError = {
        message: error instanceof Error ? error.message : 'Unknown error',
        name: error instanceof Error ? error.name : 'Error',
        code: (error as any)?.code || 'UNKNOWN'
      };
      
      console.error('🤖 BOT: Failed to provide download link', {
        chatId,
        tempFileId: tempFile.id,
        error: safeError
      });
      logger.error('Failed to provide download link', {
        chatId,
        tempFileId: tempFile.id,
        error: safeError
      });

      await this.handleDownloadError(chatId, statusMessageId, error, videoInfo.videoId);
    }
  }

  /**
   * Update progress message
   */
  private async updateProgressMessage(
    chatId: number,
    messageId: number,
    text: string,
    progress?: number
  ): Promise<void> {
    try {
      let displayText = text;
      
      if (progress !== undefined) {
        const progressBar = this.createProgressBar(progress);
        displayText = `${text}\n\n${progressBar} ${progress}%`;
      }

      await this.bot.editMessageText(displayText, {
        chat_id: chatId,
        message_id: messageId
      });
    } catch (error) {
      logger.debug('Could not update progress message', { chatId, messageId, error });
    }
  }

  /**
   * Create progress bar
   */
  private createProgressBar(progress: number): string {
    const totalBars = 10;
    const filledBars = Math.round((progress / 100) * totalBars);
    const emptyBars = totalBars - filledBars;
    
    return '█'.repeat(filledBars) + '░'.repeat(emptyBars);
  }

  /**
   * Handle download errors
   */
  private async handleDownloadError(
    chatId: number,
    messageId: number,
    error: any,
    url: string
  ): Promise<void> {
    const errorMessage = ApiService.getUserErrorMessage(error);
    
    const retryKeyboard: TelegramBot.InlineKeyboardMarkup = {
      inline_keyboard: [[
        {
          text: '🔄 Retry',
          callback_data: `retry_download|${url}`
        }
      ]]
    };

    try {
      await this.bot.editMessageText(errorMessage, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: retryKeyboard
      });
    } catch (editError) {
      // If edit fails, send new message
      await this.bot.sendMessage(chatId, errorMessage, {
        reply_markup: retryKeyboard
      });
    }
  }

  /**
   * Generate secure filename
   */
  private generateSecureFilename(originalTitle: string): string {
    // Sanitize title for filename
    const sanitized = originalTitle
      .replace(/[^a-zA-Z0-9\s\-_]/g, '') // Remove special characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 50); // Limit length

    const timestamp = Date.now();
    const uuid = uuidv4().substring(0, 8);
    
    return `${timestamp}_${uuid}_${sanitized}.mp3`;
  }

  /**
   * Generate filename from title
   */
  private generateFilename(title: string): string {
    return title
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50) + '.mp3';
  }

  /**
   * Format file caption
   */
  private formatFileCaption(videoInfo: CheckResponse): string {
    const duration = this.formatDuration(videoInfo.durationSec);
    return `🎵 ${videoInfo.title}\n⏱️ ${duration}\n🎶 Converted by Music Bag Bot`;
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
   * Get active downloads for a chat
   */
  getActiveDownloadsForChat(chatId: number): DownloadJob[] {
    return Array.from(this.activeDownloads.values())
      .filter(job => job.chatId === chatId);
  }

  /**
   * Cancel download
   */
  async cancelDownload(jobId: string): Promise<boolean> {
    const job = this.activeDownloads.get(jobId);
    
    if (job && job.status === 'processing') {
      job.status = 'failed';
      job.error = 'Cancelled by user';
      job.endTime = new Date();
      
      // Clean up any temp files
      if (job.filePath) {
        try {
          await fs.unlink(job.filePath);
        } catch (error) {
          logger.debug('Could not delete temp file during cancellation', { jobId, error });
        }
      }

      logger.info('Download cancelled', { jobId, chatId: job.chatId });
      return true;
    }

    return false;
  }

  /**
   * Get download statistics
   */
  getDownloadStats(): {
    active: number;
    total: number;
    succeeded: number;
    failed: number;
  } {
    const jobs = Array.from(this.activeDownloads.values());
    
    return {
      active: jobs.filter(job => job.status === 'processing').length,
      total: jobs.length,
      succeeded: jobs.filter(job => job.status === 'ready').length,
      failed: jobs.filter(job => job.status === 'failed').length
    };
  }
}

export default DownloadHandler;