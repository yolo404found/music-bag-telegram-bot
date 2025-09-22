import config from '../config/config';

export class UrlValidator {
  private static readonly YOUTUBE_REGEX = [
    /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+/,
    /^https?:\/\/(www\.)?youtu\.be\/[\w-]+/,
    /^https?:\/\/(www\.)?m\.youtube\.com\/watch\?v=[\w-]+/,
    /^https?:\/\/(www\.)?youtube\.com\/v\/[\w-]+/,
    /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]+/
  ];

  /**
   * Validate if the URL is a valid YouTube URL
   */
  static isValidYouTubeUrl(url: string): boolean {
    if (!url || typeof url !== 'string') {
      return false;
    }

    return this.YOUTUBE_REGEX.some(regex => regex.test(url));
  }

  /**
   * Extract video ID from YouTube URL
   */
  static extractVideoId(url: string): string | null {
    if (!this.isValidYouTubeUrl(url)) {
      return null;
    }

    // Handle different YouTube URL formats
    const patterns = [
      /[?&]v=([^&]+)/,           // ?v=VIDEO_ID
      /youtu\.be\/([^?&]+)/,     // youtu.be/VIDEO_ID
      /\/v\/([^?&]+)/,           // /v/VIDEO_ID
      /\/embed\/([^?&]+)/        // /embed/VIDEO_ID
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Check if domain is allowed
   */
  static isDomainAllowed(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.toLowerCase();
      
      return config.security.allowedDomains.some(allowedDomain => 
        domain === allowedDomain || domain.endsWith(`.${allowedDomain}`)
      );
    } catch {
      return false;
    }
  }

  /**
   * Check if URL contains blocked patterns
   */
  static containsBlockedPatterns(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return config.security.blockedPatterns.some(pattern =>
      lowerUrl.includes(pattern.toLowerCase())
    );
  }

  /**
   * Comprehensive URL validation
   */
  static validateUrl(url: string): { valid: boolean; reason?: string; videoId?: string } {
    // Basic checks
    if (!url || typeof url !== 'string') {
      return { valid: false, reason: 'URL is required' };
    }

    if (url.length > 2048) {
      return { valid: false, reason: 'URL is too long' };
    }

    // Check if it's a valid YouTube URL
    if (!this.isValidYouTubeUrl(url)) {
      return { valid: false, reason: 'Invalid YouTube URL format' };
    }

    // Check domain
    if (!this.isDomainAllowed(url)) {
      return { valid: false, reason: 'Domain not allowed' };
    }

    // Check blocked patterns
    if (this.containsBlockedPatterns(url)) {
      return { valid: false, reason: 'URL contains blocked content' };
    }

    // Extract video ID
    const videoId = this.extractVideoId(url);
    if (!videoId) {
      return { valid: false, reason: 'Could not extract video ID' };
    }

    return { valid: true, videoId };
  }

  /**
   * Sanitize URL by removing unnecessary parameters
   */
  static sanitizeUrl(url: string): string {
    try {
      new URL(url); // Validate URL format
      
      // For YouTube, keep only essential parameters
      if (this.isValidYouTubeUrl(url)) {
        const videoId = this.extractVideoId(url);
        if (videoId) {
          return `https://www.youtube.com/watch?v=${videoId}`;
        }
      }
      
      return url;
    } catch {
      return url;
    }
  }

  /**
   * Extract text that looks like URLs from a message
   */
  static extractUrls(text: string): string[] {
    const urlRegex = /https?:\/\/[^\s]+/g;
    const matches = text.match(urlRegex);
    return matches || [];
  }

  /**
   * Find the first valid YouTube URL in text
   */
  static findValidYouTubeUrl(text: string): string | null {
    const urls = this.extractUrls(text);
    
    for (const url of urls) {
      const validation = this.validateUrl(url);
      if (validation.valid) {
        return this.sanitizeUrl(url);
      }
    }
    
    return null;
  }

  /**
   * Get user-friendly error message for validation failure
   */
  static getValidationErrorMessage(reason: string): string {
    switch (reason) {
      case 'URL is required':
        return '❌ Please provide a YouTube URL.';
      case 'URL is too long':
        return '❌ The URL is too long. Please use a shorter link.';
      case 'Invalid YouTube URL format':
        return '❌ Please provide a valid YouTube URL (youtube.com or youtu.be).';
      case 'Domain not allowed':
        return '🚫 Only YouTube URLs are supported.';
      case 'URL contains blocked content':
        return '🚫 This URL contains blocked content and cannot be processed.';
      case 'Could not extract video ID':
        return '❌ Unable to extract video ID from the URL. Please check the link.';
      default:
        return '❌ Invalid URL. Please provide a valid YouTube link.';
    }
  }
}

export default UrlValidator;