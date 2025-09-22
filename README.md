# Music Bot Telegram

A comprehensive Telegram bot for downloading YouTube videos as MP3 files, implementing the API contract specifications with advanced features including rate limiting, file management, and both synchronous and asynchronous processing.

## Features

### Core Features
- ✅ YouTube URL validation and metadata extraction
- ✅ Synchronous downloads for small/quick files
- ✅ Asynchronous job queue for large/long files
- ✅ Intelligent file size handling (direct upload vs download links)
- ✅ Comprehensive rate limiting (per-minute, per-hour, per-day)
- ✅ Progress tracking and user feedback
- ✅ Secure temporary file management with TTL
- ✅ Range request support for resumable downloads
- ✅ Admin commands and statistics
- ✅ Robust error handling and recovery

### API Integration
- ✅ POST /api/check - YouTube URL validation and metadata
- ✅ POST /api/download - Synchronous streaming downloads
- ✅ POST /api/submit - Asynchronous job submission
- ✅ GET /api/status/:jobId - Job progress polling
- ✅ Health checks and API monitoring

### User Experience
- ✅ Real-time progress updates with progress bars
- ✅ Smart processing type recommendations (sync vs async)
- ✅ File size-aware upload strategies
- ✅ Temporary download links with expiration
- ✅ Inline keyboards for actions (retry, cancel, delete)
- ✅ Comprehensive help and status commands

## Architecture

### Directory Structure
```
src/
├── bot.ts                 # Main bot class
├── index.ts              # Application entry point
├── config/
│   └── config.ts         # Environment configuration
├── handlers/
│   ├── messageHandler.ts    # Message processing
│   ├── downloadHandler.ts   # Sync download logic
│   └── asyncJobHandler.ts   # Async job management
├── services/
│   ├── apiService.ts        # Backend API client
│   ├── fileService.ts       # File management
│   ├── rateLimitService.ts  # Rate limiting
│   ├── logger.ts           # Logging service
│   └── fileServer.ts       # Download file server
├── utils/
│   └── urlValidator.ts     # URL validation utilities
└── types/
    └── index.ts           # TypeScript type definitions
```

### Key Components

#### Bot Class (`src/bot.ts`)
- Main orchestrator for the Telegram bot
- Handles event setup, polling/webhook management
- Coordinates between handlers and services
- Implements graceful shutdown and error recovery

#### Message Handler (`src/handlers/messageHandler.ts`)
- Processes incoming messages and commands
- URL extraction and validation
- Routes to appropriate download handlers
- Implements bot commands (/start, /help, /status, etc.)

#### Download Handler (`src/handlers/downloadHandler.ts`)
- Manages synchronous downloads
- Handles file size checking and upload decisions
- Progress tracking and user feedback
- Error handling and retry mechanisms

#### Async Job Handler (`src/handlers/asyncJobHandler.ts`)
- Manages long-running async downloads
- Job polling and status updates
- Progress reporting and completion handling
- Job cancellation and cleanup

#### API Service (`src/services/apiService.ts`)
- HTTP client for backend API communication
- Request/response logging and error handling
- Supports streaming downloads and range requests
- Health check monitoring

#### Rate Limit Service (`src/services/rateLimitService.ts`)
- Multi-tier rate limiting (minute/hour/day)
- Admin bypass functionality
- User session tracking
- Configurable limits and cleanup

#### File Service (`src/services/fileService.ts`)
- Temporary file management
- Secure filename generation
- TTL-based cleanup
- Storage statistics and monitoring

## Installation and Setup

### Prerequisites
- Node.js 18.0.0 or higher
- npm or yarn package manager
- Access to the backend API service
- Telegram Bot Token (from @BotFather)

### Installation Steps

1. **Clone and Install Dependencies**
   ```bash
   cd music_bot_telegram
   npm install
   ```

2. **Environment Configuration**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your configuration:
   ```env
   # Required
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
   
   # API Configuration
   API_BASE_URL=http://localhost:3000
   API_TIMEOUT=300000
   
   # File Management
   TMP_DIR=./tmp
   MAX_UPLOAD_MB=50
   TMP_TTL_SECONDS=3600
   
   # Rate Limiting
   RATE_LIMIT_PER_MINUTE=5
   RATE_LIMIT_PER_HOUR=50
   RATE_LIMIT_PER_DAY=200
   
   # Security (optional)
   WEBHOOK_SECRET=your_webhook_secret_here
   ADMIN_CHAT_IDS=123456789,987654321
   ```

3. **Build the Project**
   ```bash
   npm run build
   ```

4. **Start the Bot**
   ```bash
   # Development mode
   npm run dev
   
   # Production mode
   npm start
   ```

### Deployment Options

#### Option 1: Polling Mode (Development)
- Set `NODE_ENV=development`
- Bot will use long-polling to receive updates
- Suitable for development and testing

#### Option 2: Webhook Mode (Production)
- Set `NODE_ENV=production`
- Configure `WEBHOOK_URL` in environment
- Requires HTTPS and public domain
- More efficient for production use

## Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | - | ✅ |
| `API_BASE_URL` | Backend API URL | http://localhost:3000 | ❌ |
| `API_TIMEOUT` | API request timeout (ms) | 300000 | ❌ |
| `TMP_DIR` | Temporary files directory | ./tmp | ❌ |
| `MAX_UPLOAD_MB` | Max direct upload size | 50 | ❌ |
| `TMP_TTL_SECONDS` | File expiration time | 3600 | ❌ |
| `RATE_LIMIT_PER_MINUTE` | Requests per minute | 5 | ❌ |
| `RATE_LIMIT_PER_HOUR` | Requests per hour | 50 | ❌ |
| `RATE_LIMIT_PER_DAY` | Requests per day | 200 | ❌ |
| `WEBHOOK_SECRET` | Webhook security token | - | ❌ |
| `ADMIN_CHAT_IDS` | Admin user chat IDs | - | ❌ |
| `PORT` | File server port | 8080 | ❌ |
| `LOG_LEVEL` | Logging level | info | ❌ |
| `NODE_ENV` | Environment mode | development | ❌ |

### Rate Limiting

The bot implements three-tier rate limiting:

- **Per Minute**: Quick burst protection
- **Per Hour**: Medium-term abuse prevention  
- **Per Day**: Long-term usage limits

Admin users (configured via `ADMIN_CHAT_IDS`) bypass all rate limits.

### File Management

Files are managed with security and efficiency in mind:

- **Secure Filenames**: UUID-based naming prevents conflicts
- **TTL Cleanup**: Automatic file deletion after expiration
- **Size-based Strategy**: 
  - ≤50MB: Direct Telegram upload
  - >50MB: Temporary download link
- **Range Support**: Resumable downloads for large files

## Usage

### User Commands

| Command | Description |
|---------|-------------|
| `/start` | Show welcome message and instructions |
| `/help` | Display detailed help and usage info |
| `/status` | Check bot and API status |
| `/limits` | View current rate limit usage |

### Admin Commands

| Command | Description |
|---------|-------------|
| `/stats` | View bot statistics and metrics |
| `/reset <chat_id>` | Reset rate limits for specific user |

### URL Processing

1. **Send YouTube URL**: User sends any message containing a YouTube URL
2. **Validation**: Bot validates URL format and domain
3. **Metadata Check**: Bot calls `/api/check` for video information
4. **Processing Decision**: Bot chooses sync vs async based on `recommendedProcessing`
5. **Download**: Bot processes the file and provides result
6. **Delivery**: File is either uploaded directly or provided as download link

### Supported URL Formats

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://m.youtube.com/watch?v=VIDEO_ID`
- `https://www.youtube.com/v/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`

## API Integration

### Backend Requirements

Your backend service must implement these endpoints:

#### POST /api/check
```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

Response:
```json
{
  "success": true,
  "provider": "youtube",
  "videoId": "VIDEO_ID",
  "title": "Video Title",
  "durationSec": 245,
  "thumbnail": "https://i.ytimg.com/vi/VIDEO_ID/hqdefault.jpg",
  "license": "standard",
  "isLive": false,
  "canDownload": true,
  "recommendedProcessing": "sync"
}
```

#### POST /api/download
```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "format": "mp3",
  "bitrate": "192k"
}
```

Response: Streaming MP3 data with appropriate headers

#### POST /api/submit (for async)
```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "format": "mp3",
  "bitrate": "192k"
}
```

Response:
```json
{
  "success": true,
  "jobId": "job_123abc",
  "status": "queued"
}
```

#### GET /api/status/:jobId
Response:
```json
{
  "jobId": "job_123abc",
  "status": "ready",
  "progress": 100,
  "downloadUrl": "https://yourserver/downloads/job_123abc.mp3"
}
```

## Error Handling

### User-Facing Errors

The bot provides user-friendly error messages for common scenarios:

- **Invalid URL**: Clear guidance on supported formats
- **Copyright Protected**: Explanation of licensing restrictions
- **File Too Large**: Information about download alternatives
- **Network Errors**: Encouragement to retry later
- **Rate Limits**: Clear time-based retry instructions

### System Error Recovery

- **API Failures**: Automatic retry with exponential backoff
- **Polling Errors**: Automatic restart of polling mechanism
- **File System Errors**: Graceful degradation and cleanup
- **Memory Management**: Automatic cleanup of old jobs and files

## Monitoring and Logging

### Log Levels

- **ERROR**: Critical errors requiring attention
- **WARN**: Important warnings and security events
- **INFO**: General operational information
- **DEBUG**: Detailed debugging information

### Log Categories

- **User Actions**: Message processing and commands
- **API Calls**: Backend service interactions
- **Downloads**: File processing and delivery
- **Rate Limits**: Usage tracking and violations
- **Security**: Authentication and authorization events
- **System**: Startup, shutdown, and health events

### Metrics Available

- **User Statistics**: Total users, active users, request patterns
- **Download Statistics**: Success/failure rates, file sizes, processing times
- **Rate Limit Statistics**: Usage patterns, violations, admin actions
- **File Statistics**: Storage usage, cleanup efficiency, download patterns
- **API Statistics**: Response times, error rates, health status

## Security Considerations

### Input Validation
- URL format validation
- Domain whitelist enforcement
- Parameter sanitization
- File path security

### Rate Limiting
- Multiple time-window enforcement
- Admin bypass capability
- User session tracking
- Abuse pattern detection

### File Security
- Secure temporary file naming
- TTL-based cleanup
- Access token validation
- Directory traversal prevention

### API Security
- Request timeout enforcement
- Error message sanitization
- Health check monitoring
- Secure webhook validation

## Testing

### Running Tests
```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

### Test Categories

1. **Unit Tests**: Individual component testing
2. **Integration Tests**: Service interaction testing
3. **API Tests**: Backend integration testing
4. **E2E Tests**: Full user flow testing

### Test Checklist

- ✅ URL validation with various formats
- ✅ Rate limiting enforcement
- ✅ File upload/download flows
- ✅ Error handling scenarios
- ✅ Admin command functionality
- ✅ Async job processing
- ✅ File cleanup operations

## Troubleshooting

### Common Issues

#### Bot Not Responding
1. Check bot token validity
2. Verify API service connectivity
3. Review rate limiting settings
4. Check network connectivity

#### Files Not Downloading
1. Verify backend API endpoints
2. Check file service configuration
3. Review temporary directory permissions
4. Validate download URL generation

#### Rate Limit Issues
1. Review rate limit configuration
2. Check user session management
3. Verify admin bypass settings
4. Monitor abuse patterns

#### Memory/Storage Issues
1. Review cleanup scheduler operation
2. Check temporary file TTL settings
3. Monitor disk space usage
4. Verify file service statistics

### Debug Mode

Enable debug logging:
```env
DEBUG=true
LOG_LEVEL=debug
```

This provides detailed information about:
- Message processing flows
- API request/response cycles
- File operations and cleanup
- Rate limiting decisions
- Error context and stack traces

## Contributing

### Development Setup
1. Fork the repository
2. Install dependencies: `npm install`
3. Copy environment config: `cp .env.example .env`
4. Start development server: `npm run dev`

### Code Style
- TypeScript with strict mode
- ESLint configuration included
- Prettier for code formatting
- Comprehensive type definitions

### Pull Request Guidelines
1. Include tests for new features
2. Update documentation as needed
3. Follow existing code patterns
4. Ensure all tests pass

## License

MIT License - See LICENSE file for details

## Support

For issues, questions, or contributions:
1. Check existing documentation
2. Review troubleshooting guide
3. Create detailed issue reports
4. Include relevant logs and configuration

---

**Note**: This bot is designed to work with the Music Bag backend service. Ensure your backend implements the required API endpoints as specified in the documentation.