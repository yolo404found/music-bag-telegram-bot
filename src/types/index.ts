// API Types based on the contract specifications

export interface CheckRequest {
  url: string;
}

export interface CheckResponse {
  success: boolean;
  provider: string;
  videoId: string;
  title: string;
  durationSec: number;
  thumbnail: string;
  license: 'standard' | 'creativeCommon';
  isLive: boolean;
  canDownload: boolean;
  recommendedProcessing: 'sync' | 'async';
}

export interface DownloadRequest {
  url: string;
  format: string;
  bitrate?: string;
}

export interface SubmitRequest {
  url: string;
  format: string;
  bitrate?: string;
}

export interface SubmitResponse {
  success: boolean;
  jobId: string;
  status: JobStatus;
}

export interface StatusResponse {
  jobId: string;
  status: JobStatus;
  progress?: number;
  downloadUrl?: string;
  error?: string;
}

export type JobStatus = 'queued' | 'processing' | 'ready' | 'failed';

// Search-related types
export interface SearchRequest {
  query: string;
  maxResults?: number;
  region?: string;
}

export interface SearchResultItem {
  videoId: string;
  title: string;
  channelTitle: string;
  duration: string;
  durationSec: number;
  thumbnail: string;
  url: string;
}

export interface SearchResponse {
  success: boolean;
  results: SearchResultItem[];
  totalResults: number;
  nextPageToken?: string;
  error?: string;
}

// Bot Types

export interface BotConfig {
  token: string;
  apiBaseUrl: string;
  tmpDir: string;
  maxUploadMB: number;
  tmpTtlSeconds: number;
  rateLimits: RateLimits;
  webhookSecret?: string;
  adminChatIds: number[];
}

export interface RateLimits {
  perMinute: number;
  perHour: number;
  perDay: number;
}

export interface UserSession {
  chatId: number;
  currentJob?: string;
  lastActivity: Date;
  requestCount: {
    minute: number;
    hour: number;
    day: number;
  };
}

export interface DownloadJob {
  id: string;
  chatId: number;
  url: string;
  status: JobStatus;
  messageId?: number;
  startTime: Date;
  endTime?: Date;
  filePath?: string;
  fileSize?: number;
  error?: string;
  metadata?: CheckResponse;
}

export interface TempFile {
  id: string;
  filePath: string;
  publicUrl: string;
  expiresAt: Date;
  chatId: number;
  jobId: string;
}

// Error Types

export interface ApiError {
  status: number;
  message: string;
  code?: string;
}

export interface BotError extends Error {
  code: string;
  chatId?: number;
  recoverable: boolean;
}

// Telegram Bot API Extended Types

export interface ExtendedMessage {
  chat: {
    id: number;
    type: string;
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  };
  message_id: number;
  text?: string;
  date: number;
}

export interface ProgressUpdate {
  chatId: number;
  messageId: number;
  stage: 'checking' | 'downloading' | 'converting' | 'uploading';
  progress: number;
  message: string;
}

// Configuration Types

export interface LogConfig {
  level: string;
  file: string;
  console: boolean;
}

export interface SecurityConfig {
  maxFileSize: number;
  allowedDomains: string[];
  blockedPatterns: string[];
  requiresAuth: boolean;
}

// Utility Types

export type AsyncHandler<T = any> = (data: T) => Promise<void>;
export type ErrorHandler = (error: Error, context?: any) => void;
export type Logger = {
  info: (message: string, meta?: any) => void;
  warn: (message: string, meta?: any) => void;
  error: (message: string, meta?: any) => void;
  debug: (message: string, meta?: any) => void;
};