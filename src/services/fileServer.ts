import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs-extra';
import fileService from '../services/fileService';
import logger from '../services/logger';
import config from '../config/config';

export class FileServer {
  private app: express.Application;
  private server: any;

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: false // Disable CSP for file downloads
    }));

    // CORS middleware
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
      methods: ['GET', 'HEAD'],
      allowedHeaders: ['Range', 'Content-Range']
    }));

    // Request logging
    this.app.use((req, _res, next) => {
      logger.debug('File server request', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });

    // Parse JSON (for health checks)
    this.app.use(express.json({ limit: '1mb' }));
  }

  /**
   * Setup Express routes
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        service: 'file-server'
      });
    });

    // File download endpoint
    this.app.get('/download/:token', async (req, res) => {
      try {
        await this.handleFileDownload(req, res);
      } catch (error) {
        logger.error('File download error', {
          token: req.params.token,
          error
        });
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // File info endpoint (optional)
    this.app.head('/download/:token', async (req, res) => {
      try {
        await this.handleFileInfo(req, res);
      } catch (error) {
        logger.error('File info error', {
          token: req.params.token,
          error
        });
        res.status(500).end();
      }
    });

    // 404 handler
    this.app.use('*', (_req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Global error handler
    this.app.use((error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
      logger.error('Express error', { error, url: req.url, method: req.method });
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  /**
   * Handle file download requests
   */
  private async handleFileDownload(req: express.Request, res: express.Response): Promise<void> {
    const token = req.params.token;
    
    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'Invalid token' });
      return;
    }

    // Get temp file by token
    const tempFile = fileService.getTempFile(token);
    
    if (!tempFile) {
      res.status(404).json({ error: 'File not found or expired' });
      return;
    }

    // Check if file exists
    const fileExists = await fs.pathExists(tempFile.filePath);
    if (!fileExists) {
      // Clean up expired/missing file
      await fileService.cleanupTempFile(token);
      res.status(404).json({ error: 'File not found' });
      return;
    }

    try {
      const stats = await fs.stat(tempFile.filePath);
      const fileSize = stats.size;
      const fileName = path.basename(tempFile.filePath);
      const fileInfo = fileService.getFileInfo(tempFile.filePath);

      // Set headers
      res.set({
        'Content-Type': fileInfo.mimeType,
        'Content-Length': fileSize.toString(),
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-cache',
        'Accept-Ranges': 'bytes'
      });

      // Handle Range requests (for resumable downloads)
      const range = req.get('Range');
      
      if (range) {
        await this.handleRangeRequest(req, res, tempFile.filePath, fileSize, range);
      } else {
        // Send entire file
        const fileStream = fs.createReadStream(tempFile.filePath);
        
        fileStream.on('error', (error) => {
          logger.error('File stream error', { 
            token, 
            filePath: tempFile.filePath, 
            error 
          });
          if (!res.headersSent) {
            res.status(500).json({ error: 'File read error' });
          }
        });

        fileStream.pipe(res);
      }

      logger.info('File download served', {
        token,
        fileName,
        fileSize,
        chatId: tempFile.chatId,
        hasRange: !!range
      });

    } catch (error) {
      logger.error('File download error', { token, filePath: tempFile.filePath, error });
      res.status(500).json({ error: 'File access error' });
    }
  }

  /**
   * Handle file info requests (HEAD)
   */
  private async handleFileInfo(req: express.Request, res: express.Response): Promise<void> {
    const token = req.params.token;
    
    if (!token || typeof token !== 'string') {
      res.status(400).end();
      return;
    }

    const tempFile = fileService.getTempFile(token);
    
    if (!tempFile) {
      res.status(404).end();
      return;
    }

    try {
      const stats = await fs.stat(tempFile.filePath);
      const fileInfo = fileService.getFileInfo(tempFile.filePath);

      res.set({
        'Content-Type': fileInfo.mimeType,
        'Content-Length': stats.size.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      });

      res.status(200).end();

    } catch (error) {
      res.status(404).end();
    }
  }

  /**
   * Handle Range requests for partial content
   */
  private async handleRangeRequest(
    _req: express.Request,
    res: express.Response,
    filePath: string,
    fileSize: number,
    rangeHeader: string
  ): Promise<void> {
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;

    // Validate range
    if (start >= fileSize || end >= fileSize || start > end) {
      res.status(416).set({
        'Content-Range': `bytes */${fileSize}`
      }).end();
      return;
    }

    // Set partial content headers
    res.status(206).set({
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunkSize.toString()
    });

    // Create read stream with range
    const fileStream = fs.createReadStream(filePath, { start, end });
    
    fileStream.on('error', (error) => {
      logger.error('Range request stream error', { filePath, start, end, error });
      if (!res.headersSent) {
        res.status(500).end();
      }
    });

    fileStream.pipe(res);
  }

  /**
   * Start the file server
   */
  async start(port?: number): Promise<void> {
    const serverPort = port || config.getPort();
    
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(serverPort, (error?: Error) => {
        if (error) {
          logger.error('Failed to start file server', { port: serverPort, error });
          reject(error);
        } else {
          logger.info('File server started', { port: serverPort });
          resolve();
        }
      });
    });
  }

  /**
   * Stop the file server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((error?: Error) => {
          if (error) {
            logger.error('Error stopping file server', { error });
            reject(error);
          } else {
            logger.info('File server stopped');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get Express app (for testing)
   */
  getApp(): express.Application {
    return this.app;
  }
}

export default FileServer;