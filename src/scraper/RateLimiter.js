import { getLogger } from '../utils/logger.js';

/**
 * Rate limiter to prevent overwhelming the API
 * Features:
 * - Configurable delay between requests
 * - Token bucket algorithm for burst handling
 * - Automatic rate adjustment
 */
class RateLimiter {
  /**
   * @param {number} delayMs - Minimum delay between requests in milliseconds
   * @param {number} maxBurst - Maximum number of requests in a burst
   */
  constructor(delayMs = 100, maxBurst = 10) {
    this.delayMs = delayMs;
    this.maxBurst = maxBurst;
    this.tokens = maxBurst;
    this.lastRequestTime = 0;
    this.logger = getLogger().child('RateLimiter');
  }

  /**
   * Wait before allowing next request
   * Implements token bucket algorithm
   * @returns {Promise<void>}
   */
  async wait() {
    // Refill tokens based on time elapsed
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const tokensToAdd = Math.floor(timeSinceLastRequest / this.delayMs);
    
    this.tokens = Math.min(this.tokens + tokensToAdd, this.maxBurst);

    // If no tokens available, wait
    if (this.tokens <= 0) {
      const waitTime = this.delayMs - (timeSinceLastRequest % this.delayMs);
      this.logger.debug(`Rate limit: waiting ${waitTime}ms`);
      await this.sleep(waitTime);
      this.tokens = 1;
    }

    // Consume a token
    this.tokens--;
    this.lastRequestTime = Date.now();
  }

  /**
   * Wait for a specific duration (e.g., after rate limit hit)
   * @param {number} ms - Milliseconds to wait
   * @returns {Promise<void>}
   */
  async waitFor(ms) {
    this.logger.debug(`Forced wait: ${ms}ms`);
    await this.sleep(ms);
    
    // Reset tokens after forced wait
    this.tokens = this.maxBurst;
    this.lastRequestTime = Date.now();
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
   * Adjust rate limit dynamically
   * @param {number} newDelayMs - New delay in milliseconds
   */
  adjustRate(newDelayMs) {
    this.logger.info(`Adjusting rate limit from ${this.delayMs}ms to ${newDelayMs}ms`);
    this.delayMs = newDelayMs;
  }

  /**
   * Reset rate limiter state
   */
  reset() {
    this.tokens = this.maxBurst;
    this.lastRequestTime = 0;
    this.logger.debug('Rate limiter reset');
  }

  /**
   * Get current state
   * @returns {Object} Current state
   */
  getState() {
    return {
      delayMs: this.delayMs,
      tokens: this.tokens,
      maxBurst: this.maxBurst,
      lastRequestTime: this.lastRequestTime,
    };
  }
}

export default RateLimiter;
