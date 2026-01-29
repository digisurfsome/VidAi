/**
 * Simple in-memory rate limiter for API endpoints
 * In production, use Redis or database-backed rate limiting
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 10) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    
    // Clean up expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Check if request should be allowed
   */
  check(identifier: string): { allowed: boolean; remaining: number; resetTime: number } {
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
  reset(identifier: string): void {
    this.limits.delete(identifier);
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.limits.entries()) {
      if (entry.resetTime <= now) {
        this.limits.delete(key);
      }
    }
  }
}

// Rate limiters for different endpoints
export const rateLimiters = {
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
 * Express/Vercel middleware for rate limiting
 */
export function createRateLimitMiddleware(limiter: RateLimiter) {
  return (identifier: string) => {
    const result = limiter.check(identifier);
    
    return {
      allowed: result.allowed,
      headers: {
        'X-RateLimit-Limit': limiter['maxRequests'].toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': new Date(result.resetTime).toISOString()
      },
      retryAfter: result.allowed ? undefined : Math.ceil((result.resetTime - Date.now()) / 1000)
    };
  };
}

export default RateLimiter;