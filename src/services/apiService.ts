import axios, { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { Readable } from 'stream';
import { 
  CheckRequest, 
  CheckResponse, 
  DownloadRequest, 
  SubmitRequest, 
  SubmitResponse, 
  StatusResponse,
  SearchRequest,
  SearchResponse,
  ApiError,
  Logger 
} from '../types';

export class ApiService {
  private client: AxiosInstance;
  private logger: Logger;

  constructor(baseURL: string, timeout: number = 300000, logger: Logger) {
    this.logger = logger;
    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MusicBot-Telegram/1.0'
      }
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        this.logger.debug(`API Request: ${config.method?.toUpperCase()} ${config.url}`, {
          data: config.data,
          params: config.params
        });
        return config;
      },
      (error: any) => {
        this.logger.error('API Request Error', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging and error handling
    this.client.interceptors.response.use(
      (response: AxiosResponse) => {
        this.logger.debug(`API Response: ${response.status} ${response.config.url}`, {
          data: response.data
        });
        return response;
      },
      (error: any) => {
        const apiError = this.handleApiError(error);
        this.logger.error('API Response Error', apiError);
        return Promise.reject(apiError);
      }
    );
  }

  /**
   * Search for music/videos by query
   */
  async search(query: string, maxResults: number = 10): Promise<SearchResponse> {
    try {
      const request: SearchRequest = { query, maxResults };
      const response: AxiosResponse<any> = await this.client.post('/api/search', request);
      
      // Handle nested response format from backend if needed
      const data = response.data.data || response.data;
      
      return {
        success: data.success || true,
        results: data.results || [],
        totalResults: data.totalResults || 0,
        nextPageToken: data.nextPageToken
      };
    } catch (error) {
      throw this.enhanceError(error as ApiError, 'Failed to search');
    }
  }

  /**
   * Check YouTube URL and get metadata
   */
  async checkUrl(url: string): Promise<CheckResponse> {
    try {
      const request: CheckRequest = { url };
      const response: AxiosResponse<any> = await this.client.post('/api/check', request);
      
      // Handle nested response format from backend
      const data = response.data.data || response.data;
      
      // Map backend response to expected format
      const mappedResponse: CheckResponse = {
        success: response.data.success || true,
        provider: 'youtube',
        videoId: data.id || data.videoId || '',
        title: data.title || '',
        durationSec: data.duration || data.durationSec || 0,
        thumbnail: data.thumbnail || '',
        license: data.license === 'youtube' ? 'standard' : (data.license || 'standard'),
        isLive: data.isLive || false,
        canDownload: data.canDownload || false,
        recommendedProcessing: data.recommendedProcessing || (data.duration > 300 ? 'async' : 'sync')
      };
      
      return mappedResponse;
    } catch (error) {
      throw this.enhanceError(error as ApiError, 'Failed to check URL');
    }
  }

  /**
   * Download and convert to MP3 (synchronous streaming)
   */
  async downloadStream(url: string, format: string = 'mp3', bitrate?: string): Promise<Readable> {
    try {
      const request: DownloadRequest = { url, format, ...(bitrate && { bitrate }) };
      
      console.log('🤖 BOT: Starting download stream request', { url: url.substring(0, 50), format, bitrate });
      this.logger.debug('Starting download stream request', { url: url.substring(0, 50), format, bitrate });
      
      const response = await this.client.post('/api/download', request, {
        responseType: 'stream',
        headers: {
          'Accept': 'audio/mpeg'
        },
        timeout: 300000 // 5 minutes timeout for downloads
      });

      console.log('🤖 BOT: Download stream response received', { 
        status: response.status,
        headers: {
          'content-type': response.headers['content-type'],
          'content-length': response.headers['content-length']
        }
      });
      this.logger.debug('Download stream response received', { 
        status: response.status,
        headers: {
          'content-type': response.headers['content-type'],
          'content-length': response.headers['content-length']
        }
      });

      // Validate that we got a stream response
      if (response.status !== 200) {
        throw new Error(`Download failed with status: ${response.status}`);
      }

      console.log('🤖 BOT: Returning stream data');
      return response.data as Readable;
    } catch (error) {
      // Extract only safe properties to avoid circular references
      let errorMessage = 'Unknown error';
      let errorStatus = 0;
      let errorStatusText = 'Unknown';
      
      try {
        if (error instanceof Error) {
          errorMessage = error.message;
        }
        
        // Safely extract response properties
        if (error && typeof error === 'object') {
          if ('response' in error && error.response && typeof error.response === 'object') {
            const response = error.response as any;
            errorStatus = response.status || 0;
            errorStatusText = response.statusText || 'Unknown';
          }
        }
      } catch (extractError) {
        // If extraction fails, use defaults
        errorMessage = 'Error extraction failed';
      }
      
      console.error('🤖 BOT: Download stream error', {
        message: errorMessage,
        status: errorStatus,
        statusText: errorStatusText,
        url: url.substring(0, 50)
      });
      
      // Create a clean error object for the enhancer
      const cleanError: ApiError = {
        status: errorStatus,
        message: errorMessage,
        code: errorStatus ? `HTTP_${errorStatus}` : 'UNKNOWN_ERROR'
      };
      
      this.logger.error('Download stream error details', {
        ...cleanError,
        url: url.substring(0, 50)
      });
      
      throw this.enhanceError(cleanError, 'Failed to download stream');
    }
  }

  /**
   * Download with support for Range headers (for large files)
   */
  async downloadWithRange(
    url: string, 
    format: string = 'mp3', 
    bitrate?: string,
    range?: string
  ): Promise<{ stream: Readable; contentLength?: number | undefined; contentRange?: string | undefined }> {
    try {
      const request: DownloadRequest = { url, format, ...(bitrate && { bitrate }) };
      const headers: any = {
        'Accept': 'audio/mpeg'
      };

      if (range) {
        headers['Range'] = range;
      }

      const response = await this.client.post('/api/download', request, {
        responseType: 'stream',
        headers
      });

      const contentLength = response.headers['content-length'] ? parseInt(response.headers['content-length']) : undefined;
      const contentRange = response.headers['content-range'] || undefined;

      return {
        stream: response.data as Readable,
        contentLength,
        contentRange
      };
    } catch (error) {
      throw this.enhanceError(error as ApiError, 'Failed to download with range');
    }
  }

  /**
   * Submit async job for long downloads
   */
  async submitJob(url: string, format: string = 'mp3', bitrate?: string): Promise<SubmitResponse> {
    try {
      const request: SubmitRequest = { url, format, ...(bitrate && { bitrate }) };
      const response: AxiosResponse<SubmitResponse> = await this.client.post('/api/submit', request);
      return response.data;
    } catch (error) {
      throw this.enhanceError(error as ApiError, 'Failed to submit job');
    }
  }

  /**
   * Check status of async job
   */
  async getJobStatus(jobId: string): Promise<StatusResponse> {
    try {
      const response: AxiosResponse<StatusResponse> = await this.client.get(`/api/status/${jobId}`);
      return response.data;
    } catch (error) {
      throw this.enhanceError(error as ApiError, 'Failed to get job status');
    }
  }

  /**
   * Download file from URL (for completed async jobs)
   */
  async downloadFromUrl(downloadUrl: string): Promise<Readable> {
    try {
      const response = await this.client.get(downloadUrl, {
        responseType: 'stream'
      });
      return response.data as Readable;
    } catch (error) {
      throw this.enhanceError(error as ApiError, 'Failed to download from URL');
    }
  }

  /**
   * Health check for the API
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/health');
      return true;
    } catch (error) {
      this.logger.warn('API health check failed', error);
      return false;
    }
  }

  /**
   * Handle axios errors and convert to ApiError
   */
  private handleApiError(error: any): ApiError {
    // Safely extract error information to avoid circular references
    let status = 0;
    let message = 'Unknown API error';
    let code = 'UNKNOWN_ERROR';

    try {
      if (error.response) {
        // Server responded with error status
        status = error.response.status || 0;
        message = error.response.data?.message || error.response.statusText || 'API request failed';
        code = error.response.data?.code || `HTTP_${status}`;
      } else if (error.request) {
        // Network error or timeout - extract safe properties only
        const method = error.config?.method?.toUpperCase() || 'REQUEST';
        const url = error.config?.url || 'unknown';
        status = 0;
        message = `Network error: ${method} ${url}`;
        code = 'NETWORK_ERROR';
      } else if (error.message) {
        // Other error - use message only
        message = error.message;
        code = 'UNKNOWN_ERROR';
      }
    } catch (extractError) {
      // If even extraction fails, use minimal safe info
      message = 'Failed to extract error details';
      code = 'EXTRACTION_ERROR';
    }

    return { status, message, code };
  }

  /**
   * Enhance error with additional context
   */
  private enhanceError(error: ApiError, context: string): ApiError {
    return {
      ...error,
      message: `${context}: ${error.message}`
    };
  }

  /**
   * Get human-readable error message for users
   */
  static getUserErrorMessage(error: ApiError): string {
    switch (error.status) {
      case 400:
        return '❌ Invalid YouTube URL or request. Please check the link and try again.';
      case 403:
        return '🚫 This video cannot be downloaded due to copyright or region restrictions.';
      case 404:
        return '❓ Video not found. The link might be invalid or the video might be private.';
      case 413:
        return '📁 File is too large to process. Please try a shorter video.';
      case 429:
        return '⏳ Too many requests. Please wait a moment before trying again.';
      case 0:
        if (error.code === 'NETWORK_ERROR') {
          return '🌐 Network connection error. Please try again later.';
        }
        return '❌ Service temporarily unavailable. Please try again later.';
      default:
        return '❌ An unexpected error occurred. Please try again later.';
    }
  }
}

export default ApiService;