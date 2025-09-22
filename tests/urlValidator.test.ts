import { UrlValidator } from '../src/utils/urlValidator';

describe('UrlValidator', () => {
  describe('isValidYouTubeUrl', () => {
    test('should validate standard YouTube URLs', () => {
      const validUrls = [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtube.com/watch?v=dQw4w9WgXcQ',
        'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtu.be/dQw4w9WgXcQ',
        'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://www.youtube.com/v/dQw4w9WgXcQ',
        'https://www.youtube.com/embed/dQw4w9WgXcQ'
      ];

      validUrls.forEach(url => {
        expect(UrlValidator.isValidYouTubeUrl(url)).toBe(true);
      });
    });

    test('should reject invalid URLs', () => {
      const invalidUrls = [
        'https://www.vimeo.com/123456789',
        'https://www.dailymotion.com/video/xyz',
        'not a url at all',
        '',
        null,
        undefined,
        'https://malicious-site.com/watch?v=dQw4w9WgXcQ'
      ];

      invalidUrls.forEach(url => {
        expect(UrlValidator.isValidYouTubeUrl(url as any)).toBe(false);
      });
    });
  });

  describe('extractVideoId', () => {
    test('should extract video ID from various YouTube URL formats', () => {
      const testCases = [
        {
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          expected: 'dQw4w9WgXcQ'
        },
        {
          url: 'https://youtu.be/dQw4w9WgXcQ',
          expected: 'dQw4w9WgXcQ'
        },
        {
          url: 'https://www.youtube.com/v/dQw4w9WgXcQ',
          expected: 'dQw4w9WgXcQ'
        },
        {
          url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
          expected: 'dQw4w9WgXcQ'
        }
      ];

      testCases.forEach(({ url, expected }) => {
        expect(UrlValidator.extractVideoId(url)).toBe(expected);
      });
    });

    test('should return null for invalid URLs', () => {
      const invalidUrls = [
        'https://www.vimeo.com/123456789',
        'not a url',
        ''
      ];

      invalidUrls.forEach(url => {
        expect(UrlValidator.extractVideoId(url)).toBeNull();
      });
    });
  });

  describe('validateUrl', () => {
    test('should return valid result for proper YouTube URLs', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const result = UrlValidator.validateUrl(url);

      expect(result.valid).toBe(true);
      expect(result.videoId).toBe('dQw4w9WgXcQ');
      expect(result.reason).toBeUndefined();
    });

    test('should return invalid result with reason for bad URLs', () => {
      const url = 'https://www.vimeo.com/123456789';
      const result = UrlValidator.validateUrl(url);

      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.videoId).toBeUndefined();
    });

    test('should handle empty or null URLs', () => {
      expect(UrlValidator.validateUrl('')).toEqual({
        valid: false,
        reason: 'URL is required'
      });

      expect(UrlValidator.validateUrl(null as any)).toEqual({
        valid: false,
        reason: 'URL is required'
      });
    });
  });

  describe('sanitizeUrl', () => {
    test('should convert various YouTube URLs to standard format', () => {
      const testCases = [
        {
          input: 'https://youtu.be/dQw4w9WgXcQ?t=42',
          expected: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        },
        {
          input: 'https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmRdnEQy4QdXioDYI8PcD1jKkI85s',
          expected: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        }
      ];

      testCases.forEach(({ input, expected }) => {
        expect(UrlValidator.sanitizeUrl(input)).toBe(expected);
      });
    });
  });

  describe('findValidYouTubeUrl', () => {
    test('should find YouTube URL in text', () => {
      const text = 'Check out this video: https://www.youtube.com/watch?v=dQw4w9WgXcQ awesome!';
      const result = UrlValidator.findValidYouTubeUrl(text);

      expect(result).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });

    test('should return null if no valid YouTube URL found', () => {
      const text = 'Check out this video: https://www.vimeo.com/123456789';
      const result = UrlValidator.findValidYouTubeUrl(text);

      expect(result).toBeNull();
    });

    test('should return the first valid YouTube URL if multiple found', () => {
      const text = 'Video 1: https://www.youtube.com/watch?v=first Video 2: https://www.youtube.com/watch?v=second';
      const result = UrlValidator.findValidYouTubeUrl(text);

      expect(result).toBe('https://www.youtube.com/watch?v=first');
    });
  });
});