import axios from 'axios';
import { getLogger } from '../utils/logger.js';

/**
 * HTTP client with automatic retry logic and rate limit handling
 * Features:
 * - Exponential backoff retry (5 attempts)
 * - Rate limit detection and handling
 * - Timeout management
 * - Error classification (retryable vs non-retryable)
 */
class ApiClient {
  /**
   * @param {string} baseUrl - Base URL for API requests
   * @param {number} timeout - Request timeout in milliseconds
   * @param {number} maxRetries - Maximum number of retry attempts
   */
  constructor(baseUrl, timeout = 15000, maxRetries = 5) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
    this.maxRetries = maxRetries;
    this.logger = getLogger().child('ApiClient');

    // Create axios instance with default config
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
  }

  /**
   * GET request with retry logic
   * @param {string} url - URL path (relative to baseUrl)
   * @param {Object} params - Query parameters
   * @param {Object} options - Additional axios options
   * @returns {Promise<Object>} Response data
   */
  async get(url, params = {}, options = {}) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this.logger.debug(`Requesting ${url} (attempt ${attempt}/${this.maxRetries})`);

        const response = await this.client.get(url, {
          params,
          ...options,
        });

        // Check for rate limit headers
        this.parseRateLimitHeaders(response);

        return response.data;
      } catch (error) {
        lastError = error;

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          this.logger.error(`Non-retryable error for ${url}`, error);
          throw error;
        }

        // Handle rate limiting (HTTP 429)
        if (error.response && error.response.status === 429) {
          const retryAfter = this.getRetryAfter(error.response);
          this.logger.warn(`Rate limit hit for ${url}, waiting ${retryAfter}ms`);
          await this.sleep(retryAfter);
          continue;
        }

        // If this was the last attempt, throw the error
        if (attempt === this.maxRetries) {
          this.logger.error(`Max retries exceeded for ${url}`, error);
          throw error;
        }

        // Calculate backoff delay
        const backoffDelay = this.calculateBackoff(attempt);
        this.logger.warn(
          `Request failed for ${url}, retrying in ${backoffDelay}ms (attempt ${attempt}/${this.maxRetries})`
        );

        await this.sleep(backoffDelay);
      }
    }

    throw lastError;
  }

  /**
   * Parse and log rate limit headers
   * @param {Object} response - Axios response object
   */
  parseRateLimitHeaders(response) {
    const headers = response.headers;
    
    if (headers['x-ratelimit-remaining']) {
      const remaining = parseInt(headers['x-ratelimit-remaining'], 10);
      
      // Warn if approaching rate limit
      if (remaining < 10) {
        this.logger.warn(`Rate limit warning: ${remaining} requests remaining`);
      }
    }
  }

  /**
   * Get retry delay from response headers or use default
   * @param {Object} response - Axios response object
   * @returns {number} Delay in milliseconds
   */
  getRetryAfter(response) {
    const retryAfter = response.headers['retry-after'];
    
    if (retryAfter) {
      // retry-after can be in seconds or a date
      const delay = parseInt(retryAfter, 10);
      return isNaN(delay) ? 2000 : delay * 1000;
    }
    
    return 2000; // Default 2 seconds
  }

  /**
   * Calculate exponential backoff delay
   * Formula: base * (2 ^ attempt) seconds
   * Example: 2s, 4s, 8s, 16s, 32s
   * @param {number} attempt - Current attempt number (1-indexed)
   * @returns {number} Delay in milliseconds
   */
  calculateBackoff(attempt) {
    const base = 2; // Base delay in seconds
    const delay = base * Math.pow(2, attempt - 1);
    const maxDelay = 32; // Cap at 32 seconds
    
    return Math.min(delay, maxDelay) * 1000;
  }

  /**
   * Check if error is retryable
   * @param {Error} error - Error object
   * @returns {boolean} True if retryable
   */
  isRetryableError(error) {
    // No response = network error (retryable)
    if (!error.response) {
      return true;
    }

    const status = error.response.status;

    // Retryable status codes
    const retryableStatuses = [
      408, // Request Timeout
      429, // Too Many Requests
      500, // Internal Server Error
      502, // Bad Gateway
      503, // Service Unavailable
      504, // Gateway Timeout
    ];

    return retryableStatuses.includes(status);
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Set custom headers
   * @param {Object} headers - Headers to set
   */
  setHeaders(headers) {
    Object.assign(this.client.defaults.headers, headers);
  }

  /**
   * Get current timeout setting
   * @returns {number} Timeout in milliseconds
   */
  getTimeout() {
    return this.timeout;
  }

  /**
   * Update timeout setting
   * @param {number} timeout - New timeout in milliseconds
   */
  setTimeout(timeout) {
    this.timeout = timeout;
    this.client.defaults.timeout = timeout;
  }
}

export default ApiClient;
