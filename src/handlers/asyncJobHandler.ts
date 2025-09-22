import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import { ApiService } from '../services/apiService';
import fileService from '../services/fileService';
import logger from '../services/logger';
import config from '../config/config';
import { CheckResponse, DownloadJob, StatusResponse } from '../types';

interface AsyncJob extends DownloadJob {
  apiJobId?: string;
  lastPolled: Date;
  pollCount: number;
  retryCount: number;
}

export class AsyncJobHandler {
  private bot: TelegramBot;
  private apiService: ApiService;
  private jobs: Map<string, AsyncJob> = new Map();
  private pollingInterval: NodeJS.Timeout | null = null;

  constructor(bot: TelegramBot, apiService: ApiService) {
    this.bot = bot;
    this.apiService = apiService;
    this.startJobPolling();
    this.startCleanupScheduler();
  }

  /**
   * Process asynchronous download
   */
  async processAsyncDownload(
    chatId: number,
    url: string,
    videoInfo: CheckResponse,
    statusMessageId: number
  ): Promise<void> {
    const jobId = this.generateJobId();
    const startTime = new Date();

    try {
      // Update status message
      await this.updateStatusMessage(
        chatId,
        statusMessageId,
        '⏳ Queuing download...',
        jobId
      );

      // Submit job to API
      const submitResult = await this.apiService.submitJob(url, 'mp3', '192k');

      // Create async job record
      const job: AsyncJob = {
        id: jobId,
        apiJobId: submitResult.jobId,
        chatId,
        url,
        status: 'queued',
        messageId: statusMessageId,
        startTime,
        metadata: videoInfo,
        lastPolled: new Date(),
        pollCount: 0,
        retryCount: 0
      };

      this.jobs.set(jobId, job);

      logger.info('Async job submitted', {
        jobId,
        apiJobId: submitResult.jobId,
        chatId,
        url: url.substring(0, 50)
      });

      // Update status message with job info
      await this.updateStatusMessage(
        chatId,
        statusMessageId,
        '⏳ Your download is queued...',
        jobId,
        videoInfo
      );

    } catch (error) {
      logger.error('Failed to submit async job', { chatId, url, error });
      await this.handleJobError(chatId, statusMessageId, error, url);
    }
  }

  /**
   * Start job polling
   */
  private startJobPolling(): void {
    // Poll every 10 seconds
    this.pollingInterval = setInterval(async () => {
      await this.pollJobs();
    }, 10000);

    logger.info('Async job polling started');
  }

  /**
   * Poll all active jobs
   */
  private async pollJobs(): Promise<void> {
    const activeJobs = Array.from(this.jobs.values())
      .filter(job => job.status === 'queued' || job.status === 'processing');

    if (activeJobs.length === 0) {
      return;
    }

    logger.debug('Polling async jobs', { count: activeJobs.length });

    for (const job of activeJobs) {
      try {
        await this.pollJob(job);
      } catch (error) {
        logger.error('Error polling job', { jobId: job.id, error });
        await this.handleJobPollError(job, error);
      }
    }
  }

  /**
   * Poll individual job
   */
  private async pollJob(job: AsyncJob): Promise<void> {
    if (!job.apiJobId) {
      logger.warn('Job missing API job ID', { jobId: job.id });
      return;
    }

    try {
      const status = await this.apiService.getJobStatus(job.apiJobId);
      job.lastPolled = new Date();
      job.pollCount++;

      logger.debug('Job status polled', {
        jobId: job.id,
        apiJobId: job.apiJobId,
        status: status.status,
        progress: status.progress
      });

      switch (status.status) {
        case 'queued':
          // Still queued, update message if needed
          if (job.status !== 'queued') {
            job.status = 'queued';
            await this.updateJobProgress(job, status);
          }
          break;

        case 'processing':
          // Processing, update progress
          job.status = 'processing';
          await this.updateJobProgress(job, status);
          break;

        case 'ready':
          // Job completed successfully
          await this.handleJobCompleted(job, status);
          break;

        case 'failed':
          // Job failed
          await this.handleJobFailed(job, status);
          break;
      }

    } catch (error) {
      job.retryCount++;
      logger.warn('Job polling failed', {
        jobId: job.id,
        apiJobId: job.apiJobId,
        retryCount: job.retryCount,
        error
      });

      // If too many retries, mark as failed
      if (job.retryCount >= 5) {
        await this.handleJobFailed(job, {
          jobId: job.apiJobId,
          status: 'failed',
          error: 'Too many polling failures'
        });
      }
    }
  }

  /**
   * Handle job completion
   */
  private async handleJobCompleted(job: AsyncJob, status: StatusResponse): Promise<void> {
    try {
      if (!status.downloadUrl) {
        throw new Error('No download URL provided');
      }

      logger.info('Async job completed', {
        jobId: job.id,
        apiJobId: job.apiJobId,
        chatId: job.chatId
      });

      // Update status
      job.status = 'ready';
      job.endTime = new Date();

      // Download file from the provided URL
      const stream = await this.apiService.downloadFromUrl(status.downloadUrl);
      
      // Create temp file
      const filename = this.generateFilename(job.metadata?.title || 'audio');
      const tempFile = await fileService.createTempFileFromStream(
        stream,
        job.chatId,
        job.id,
        filename
      );

      // Check file size and decide upload method
      const fileSize = await fileService.getFileSize(tempFile.filePath);
      job.fileSize = fileSize;
      job.filePath = tempFile.filePath;

      if (fileSize <= config.security.maxFileSize) {
        await this.uploadToTelegram(job, tempFile);
        await fileService.cleanupTempFile(tempFile.id);
      } else {
        await this.provideDownloadLink(job, tempFile);
      }

      // Remove job from active jobs after a delay
      setTimeout(() => {
        this.jobs.delete(job.id);
      }, 300000); // 5 minutes

    } catch (error) {
      logger.error('Error handling completed job', {
        jobId: job.id,
        apiJobId: job.apiJobId,
        error
      });

      await this.handleJobFailed(job, {
        jobId: job.apiJobId!,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Processing failed'
      });
    }
  }

  /**
   * Handle job failure
   */
  private async handleJobFailed(job: AsyncJob, status: StatusResponse): Promise<void> {
    job.status = 'failed';
    job.error = status.error || 'Job failed';
    job.endTime = new Date();

    logger.info('Async job failed', {
      jobId: job.id,
      apiJobId: job.apiJobId,
      chatId: job.chatId,
      error: job.error
    });

    const errorMessage = this.getJobErrorMessage(job.error);
    
    try {
      await this.bot.editMessageText(errorMessage, {
        chat_id: job.chatId,
        message_id: job.messageId!,
        reply_markup: {
          inline_keyboard: [[
            {
              text: '🔄 Retry',
              callback_data: `retry_download|${job.url}`
            }
          ]]
        }
      });
    } catch (error) {
      logger.error('Failed to update failed job message', {
        jobId: job.id,
        chatId: job.chatId,
        error
      });
    }

    // Remove job after delay
    setTimeout(() => {
      this.jobs.delete(job.id);
    }, 300000); // 5 minutes
  }

  /**
   * Update job progress
   */
  private async updateJobProgress(job: AsyncJob, status: StatusResponse): Promise<void> {
    const progress = status.progress || 0;
    const progressBar = this.createProgressBar(progress);
    
    let statusText: string;
    if (job.status === 'queued') {
      statusText = '⏳ Your download is queued...';
    } else {
      statusText = '🔄 Processing your download...';
    }

    const messageText = `
${statusText}

🎵 **${job.metadata?.title || 'Audio'}**
⏱️ **Duration:** ${this.formatDuration(job.metadata?.durationSec || 0)}

${progressBar} ${progress}%

⏱️ **Started:** ${job.startTime.toLocaleTimeString()}
📊 **Status:** ${job.status === 'queued' ? 'Queued' : 'Processing'}
    `.trim();

    try {
      await this.bot.editMessageText(messageText, {
        chat_id: job.chatId,
        message_id: job.messageId!,
        reply_markup: {
          inline_keyboard: [[
            {
              text: '❌ Cancel',
              callback_data: `cancel_download|${job.id}`
            }
          ]]
        }
      });
    } catch (error) {
      logger.debug('Could not update job progress message', {
        jobId: job.id,
        chatId: job.chatId,
        error
      });
    }
  }

  /**
   * Upload file to Telegram
   */
  private async uploadToTelegram(job: AsyncJob, tempFile: any): Promise<void> {
    try {
      const fileStream = fileService.createReadStream(tempFile.filePath);
      
      const audioOptions: TelegramBot.SendAudioOptions = {
        title: job.metadata?.title || 'Audio',
        performer: 'YouTube',
        duration: job.metadata?.durationSec,
        caption: `🎵 ${job.metadata?.title}\n🎶 Converted by Music Bag Bot`
      };

      await this.bot.sendAudio(job.chatId, fileStream, audioOptions);

      // Delete status message
      try {
        await this.bot.deleteMessage(job.chatId, job.messageId!);
      } catch (error) {
        logger.debug('Could not delete status message', { jobId: job.id, error });
      }

    } catch (error) {
      logger.error('Failed to upload file to Telegram', { jobId: job.id, error });
      // Fallback to download link
      await this.provideDownloadLink(job, tempFile);
    }
  }

  /**
   * Provide download link
   */
  private async provideDownloadLink(job: AsyncJob, tempFile: any): Promise<void> {
    const fileSize = await fileService.getFileSize(tempFile.filePath);
    const fileSizeMB = Math.round((fileSize / 1024 / 1024) * 100) / 100;
    const expiresIn = Math.round(config.bot.tmpTtlSeconds / 3600);
    
    const downloadText = `
✅ **Download Ready**

🎵 **${job.metadata?.title || 'Audio'}**
📊 **Size:** ${fileSizeMB} MB
⏱️ **Duration:** ${this.formatDuration(job.metadata?.durationSec || 0)}

📁 Your file is ready for download!
🔗 [**Download MP3**](${config.bot.apiBaseUrl}${tempFile.publicUrl})

⚠️ **Important:**
• Link expires in ${expiresIn} hour${expiresIn !== 1 ? 's' : ''}
• File will be automatically deleted after expiration

_Async processing completed_
    `.trim();

    try {
      await this.bot.editMessageText(downloadText, {
        chat_id: job.chatId,
        message_id: job.messageId!,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[
            {
              text: '🔗 Download',
              url: `${config.bot.apiBaseUrl}${tempFile.publicUrl}`
            },
            {
              text: '🗑️ Delete',
              callback_data: `delete_file|${tempFile.id}`
            }
          ]]
        }
      });
    } catch (error) {
      logger.error('Failed to provide download link', { jobId: job.id, error });
    }
  }

  /**
   * Update status message
   */
  private async updateStatusMessage(
    chatId: number,
    messageId: number,
    text: string,
    jobId?: string,
    videoInfo?: CheckResponse
  ): Promise<void> {
    try {
      let messageText = text;
      
      if (videoInfo) {
        messageText = `
${text}

🎵 **${videoInfo.title}**
⏱️ **Duration:** ${this.formatDuration(videoInfo.durationSec)}
🔄 **Processing Type:** Async (Long/Large file)

${jobId ? `📋 **Job ID:** \`${jobId.substring(0, 8)}\`` : ''}

Please wait, this may take a few minutes...
        `.trim();
      }

      await this.bot.editMessageText(messageText, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
      });
    } catch (error) {
      logger.debug('Could not update status message', { chatId, messageId, error });
    }
  }

  /**
   * Handle job polling error
   */
  private async handleJobPollError(job: AsyncJob, _error: any): Promise<void> {
    job.retryCount++;
    
    if (job.retryCount >= 5) {
      await this.handleJobFailed(job, {
        jobId: job.apiJobId!,
        status: 'failed',
        error: 'Too many polling failures'
      });
    }
  }

  /**
   * Handle general job error
   */
  private async handleJobError(
    chatId: number,
    messageId: number,
    error: any,
    url: string
  ): Promise<void> {
    const errorMessage = this.getJobErrorMessage(
      error instanceof Error ? error.message : 'Unknown error'
    );
    
    try {
      await this.bot.editMessageText(errorMessage, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [[
            {
              text: '🔄 Retry',
              callback_data: `retry_download|${url}`
            }
          ]]
        }
      });
    } catch (editError) {
      logger.error('Failed to update error message', { chatId, messageId, editError });
    }
  }

  /**
   * Cancel job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    
    if (job) {
      job.status = 'failed';
      job.error = 'Cancelled by user';
      job.endTime = new Date();
      
      logger.info('Async job cancelled', { jobId, chatId: job.chatId });
      
      try {
        await this.bot.editMessageText('❌ Download cancelled by user.', {
          chat_id: job.chatId,
          message_id: job.messageId!
        });
      } catch (error) {
        logger.debug('Could not update cancelled job message', { jobId, error });
      }
      
      // Remove job after delay
      setTimeout(() => {
        this.jobs.delete(jobId);
      }, 60000); // 1 minute
      
      return true;
    }
    
    return false;
  }

  /**
   * Start cleanup scheduler
   */
  private startCleanupScheduler(): void {
    // Clean up old jobs every hour
    cron.schedule('0 * * * *', () => {
      this.cleanupOldJobs();
    });

    logger.info('Async job cleanup scheduler started');
  }

  /**
   * Clean up old jobs
   */
  private cleanupOldJobs(): void {
    const now = new Date();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    let cleanedCount = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      const age = now.getTime() - job.startTime.getTime();
      
      if (age > maxAge || (job.endTime && job.status !== 'processing')) {
        this.jobs.delete(jobId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info('Cleaned up old async jobs', { cleanedCount });
    }
  }

  /**
   * Utility methods
   */
  private generateJobId(): string {
    return `async_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  private generateFilename(title: string): string {
    return title
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50) + '.mp3';
  }

  private createProgressBar(progress: number): string {
    const totalBars = 10;
    const filledBars = Math.round((progress / 100) * totalBars);
    const emptyBars = totalBars - filledBars;
    
    return '█'.repeat(filledBars) + '░'.repeat(emptyBars);
  }

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

  private getJobErrorMessage(error: string): string {
    if (error.includes('copyright') || error.includes('restricted')) {
      return '🚫 This video cannot be downloaded due to copyright restrictions.';
    }
    if (error.includes('not found') || error.includes('404')) {
      return '❓ Video not found. The link might be invalid or the video might be private.';
    }
    if (error.includes('timeout') || error.includes('network')) {
      return '🌐 Network timeout. Please try again later.';
    }
    return '❌ Download failed. Please try again or contact support if the problem persists.';
  }

  /**
   * Get job statistics
   */
  getJobStats(): {
    total: number;
    queued: number;
    processing: number;
    completed: number;
    failed: number;
  } {
    const jobs = Array.from(this.jobs.values());
    
    return {
      total: jobs.length,
      queued: jobs.filter(job => job.status === 'queued').length,
      processing: jobs.filter(job => job.status === 'processing').length,
      completed: jobs.filter(job => job.status === 'ready').length,
      failed: jobs.filter(job => job.status === 'failed').length
    };
  }

  /**
   * Stop job polling
   */
  stop(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      logger.info('Async job polling stopped');
    }
  }
}

export default AsyncJobHandler;