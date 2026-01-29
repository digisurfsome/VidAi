/**
 * Simple in-memory rate limiter for API endpoints
 * JavaScript version for API endpoints
 */

class RateLimiter {
  constructor(windowMs = 60000, maxRequests = 10) {
    this.limits = new Map();
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    
    // Clean up expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Check if request should be allowed
   */
  check(identifier) {
    const now = Date.now();
    const entry = this.limits.get(identifier);

    // If no entry or window expired, create new entry
    if (!entry || entry.resetTime <= now) {
      this.limits.set(identifier, {
        count: 1,
        resetTime: now + this.windowMs
      });
      
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetTime: now + this.windowMs
      };
    }

    // Check if limit exceeded
    if (entry.count >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.resetTime
      };
    }

    // Increment counter
    entry.count++;
    
    return {
      allowed: true,
      remaining: this.maxRequests - entry.count,
      resetTime: entry.resetTime
    };
  }

  /**
   * Reset limits for an identifier
   */
  reset(identifier) {
    this.limits.delete(identifier);
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.limits.entries()) {
      if (entry.resetTime <= now) {
        this.limits.delete(key);
      }
    }
  }
}

// Rate limiters for different endpoints
const rateLimiters = {
  // Video generation: 5 requests per minute per user
  generation: new RateLimiter(60000, 5),
  
  // Status checks: 60 requests per minute per user
  status: new RateLimiter(60000, 60),
  
  // History: 30 requests per minute per user
  history: new RateLimiter(60000, 30),
  
  // API key validation: 10 requests per minute per user
  validation: new RateLimiter(60000, 10)
};

/**
 * Apply rate limiting to a request
 */
function applyRateLimit(limiter, identifier, res) {
  const result = limiter.check(identifier);
  
  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', limiter.maxRequests.toString());
  res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
  res.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());
  
  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
    res.setHeader('Retry-After', retryAfter.toString());
    return {
      allowed: false,
      error: {
        message: 'Too many requests. Please try again later.',
        retryAfter
      }
    };
  }
  
  return { allowed: true };
}

export {
  RateLimiter,
  rateLimiters,
  applyRateLimit
};