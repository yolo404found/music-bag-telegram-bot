import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Readable } from 'stream';
import { TempFile } from '../types';
import config from '../config/config';
import logger from './logger';

export class FileService {
  private tempFiles: Map<string, TempFile> = new Map();

  constructor() {
    this.ensureTmpDir();
    this.startCleanupScheduler();
  }

  /**
   * Ensure temporary directory exists
   */
  private ensureTmpDir(): void {
    try {
      fs.ensureDirSync(config.bot.tmpDir);
      logger.debug('Temporary directory ensured', { tmpDir: config.bot.tmpDir });
    } catch (error) {
      logger.error('Failed to create temporary directory', { tmpDir: config.bot.tmpDir, error });
      throw error;
    }
  }

  /**
   * Generate secure filename
   */
  private generateSecureFilename(extension: string = 'mp3'): string {
    const uuid = uuidv4();
    const timestamp = Date.now();
    return `${timestamp}-${uuid}.${extension}`;
  }

  /**
   * Generate public URL token
   */
  private generateUrlToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create temporary file from stream
   */
  async createTempFileFromStream(
    stream: Readable,
    chatId: number,
    jobId: string,
    filename?: string
  ): Promise<TempFile> {
    const secureFilename = filename || this.generateSecureFilename();
    const filePath = path.join(config.bot.tmpDir, secureFilename);
    const urlToken = this.generateUrlToken();
    const expiresAt = new Date(Date.now() + config.bot.tmpTtlSeconds * 1000);

    try {
      // Create write stream
      const writeStream = fs.createWriteStream(filePath);
      
      // Pipe stream to file
      stream.pipe(writeStream);

      // Wait for stream to finish
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        stream.on('error', reject);
      });

      const tempFile: TempFile = {
        id: urlToken,
        filePath,
        publicUrl: `/download/${urlToken}`,
        expiresAt,
        chatId,
        jobId
      };

      this.tempFiles.set(urlToken, tempFile);
      
      logger.info('Temporary file created', {
        chatId,
        jobId,
        filePath,
        expiresAt
      });

      return tempFile;
    } catch (error) {
      // Clean up file if it was created
      try {
        await fs.unlink(filePath);
      } catch (unlinkError) {
        logger.warn('Failed to clean up temporary file after error', { filePath, unlinkError });
      }
      
      logger.error('Failed to create temporary file', { chatId, jobId, filePath, error });
      throw error;
    }
  }

  /**
   * Save buffer to temporary file
   */
  async saveTempFile(
    buffer: Buffer,
    chatId: number,
    jobId: string,
    filename?: string
  ): Promise<TempFile> {
    const secureFilename = filename || this.generateSecureFilename();
    const filePath = path.join(config.bot.tmpDir, secureFilename);
    const urlToken = this.generateUrlToken();
    const expiresAt = new Date(Date.now() + config.bot.tmpTtlSeconds * 1000);

    try {
      await fs.writeFile(filePath, buffer);

      const tempFile: TempFile = {
        id: urlToken,
        filePath,
        publicUrl: `/download/${urlToken}`,
        expiresAt,
        chatId,
        jobId
      };

      this.tempFiles.set(urlToken, tempFile);
      
      logger.info('Temporary file saved', {
        chatId,
        jobId,
        filePath,
        size: buffer.length,
        expiresAt
      });

      return tempFile;
    } catch (error) {
      logger.error('Failed to save temporary file', { chatId, jobId, filePath, error });
      throw error;
    }
  }

  /**
   * Get temporary file by token
   */
  getTempFile(token: string): TempFile | undefined {
    const tempFile = this.tempFiles.get(token);
    
    if (tempFile && tempFile.expiresAt < new Date()) {
      // File expired, clean it up
      this.cleanupTempFile(token);
      return undefined;
    }
    
    return tempFile;
  }

  /**
   * Get file size
   */
  async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch (error) {
      logger.error('Failed to get file size', { filePath, error });
      throw error;
    }
  }

  /**
   * Check if file is within upload size limit
   */
  async isWithinUploadLimit(filePath: string): Promise<boolean> {
    try {
      const size = await this.getFileSize(filePath);
      return size <= config.security.maxFileSize;
    } catch (error) {
      logger.error('Failed to check file size limit', { filePath, error });
      return false;
    }
  }

  /**
   * Create read stream for file
   */
  createReadStream(filePath: string): Readable {
    return fs.createReadStream(filePath);
  }

  /**
   * Clean up temporary file
   */
  async cleanupTempFile(token: string): Promise<void> {
    const tempFile = this.tempFiles.get(token);
    
    if (tempFile) {
      try {
        await fs.unlink(tempFile.filePath);
        logger.debug('Temporary file deleted', { 
          token, 
          filePath: tempFile.filePath,
          chatId: tempFile.chatId 
        });
      } catch (error) {
        logger.warn('Failed to delete temporary file', { 
          token, 
          filePath: tempFile.filePath, 
          error 
        });
      }
      
      this.tempFiles.delete(token);
    }
  }

  /**
   * Clean up all expired files
   */
  async cleanupExpiredFiles(): Promise<number> {
    const now = new Date();
    const expiredTokens: string[] = [];
    
    for (const [token, tempFile] of this.tempFiles.entries()) {
      if (tempFile.expiresAt < now) {
        expiredTokens.push(token);
      }
    }

    for (const token of expiredTokens) {
      await this.cleanupTempFile(token);
    }

    if (expiredTokens.length > 0) {
      logger.info('Cleaned up expired files', { count: expiredTokens.length });
    }

    return expiredTokens.length;
  }

  /**
   * Clean up files for specific chat
   */
  async cleanupChatFiles(chatId: number): Promise<number> {
    const chatTokens: string[] = [];
    
    for (const [token, tempFile] of this.tempFiles.entries()) {
      if (tempFile.chatId === chatId) {
        chatTokens.push(token);
      }
    }

    for (const token of chatTokens) {
      await this.cleanupTempFile(token);
    }

    if (chatTokens.length > 0) {
      logger.info('Cleaned up chat files', { chatId, count: chatTokens.length });
    }

    return chatTokens.length;
  }

  /**
   * Get file format information
   */
  getFileInfo(filePath: string): { extension: string; mimeType: string } {
    const extension = path.extname(filePath).toLowerCase();
    
    const mimeTypes: { [key: string]: string } = {
      '.mp3': 'audio/mpeg',
      '.mp4': 'video/mp4',
      '.m4a': 'audio/mp4',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
      '.ogg': 'audio/ogg'
    };

    return {
      extension: extension.slice(1), // Remove the dot
      mimeType: mimeTypes[extension] || 'application/octet-stream'
    };
  }

  /**
   * Start cleanup scheduler
   */
  private startCleanupScheduler(): void {
    // Clean up expired files every 15 minutes
    setInterval(async () => {
      try {
        await this.cleanupExpiredFiles();
      } catch (error) {
        logger.error('Scheduled cleanup failed', { error });
      }
    }, 15 * 60 * 1000);

    logger.debug('File cleanup scheduler started');
  }

  /**
   * Get storage stats
   */
  async getStorageStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    expiredFiles: number;
    oldestFile?: Date | undefined;
    newestFile?: Date | undefined;
  }> {
    const stats = {
      totalFiles: this.tempFiles.size,
      totalSize: 0,
      expiredFiles: 0,
      oldestFile: undefined as Date | undefined,
      newestFile: undefined as Date | undefined
    };

    const now = new Date();

    for (const tempFile of this.tempFiles.values()) {
      if (tempFile.expiresAt < now) {
        stats.expiredFiles++;
      }

      try {
        const size = await this.getFileSize(tempFile.filePath);
        stats.totalSize += size;
      } catch (error) {
        logger.warn('Failed to get file size for stats', { filePath: tempFile.filePath, error });
      }

      const fileDate = new Date(tempFile.expiresAt.getTime() - config.bot.tmpTtlSeconds * 1000);
      
      if (!stats.oldestFile || fileDate < stats.oldestFile) {
        stats.oldestFile = fileDate;
      }
      
      if (!stats.newestFile || fileDate > stats.newestFile) {
        stats.newestFile = fileDate;
      }
    }

    return stats;
  }

  /**
   * Emergency cleanup - remove all temporary files
   */
  async emergencyCleanup(): Promise<number> {
    const allTokens = Array.from(this.tempFiles.keys());
    
    for (const token of allTokens) {
      await this.cleanupTempFile(token);
    }

    logger.warn('Emergency cleanup performed', { filesRemoved: allTokens.length });
    return allTokens.length;
  }
}

// Create and export singleton instance
export const fileService = new FileService();
export default fileService;