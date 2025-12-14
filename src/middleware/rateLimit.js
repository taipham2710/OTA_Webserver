const rateLimitStore = new Map();

const cleanupInterval = 60000;

setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (now - data.resetTime > cleanupInterval) {
      rateLimitStore.delete(key);
    }
  }
}, cleanupInterval);

export const rateLimitDevice = (maxRequests = 60, windowMs = 60000) => {
  return (req, res, next) => {
    const { deviceId } = req.params;

    if (!deviceId) {
      return next();
    }

    const key = `device:${deviceId}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    let rateData = rateLimitStore.get(key);

    if (!rateData || now >= rateData.resetTime) {
      rateData = {
        requests: [],
        resetTime: now + windowMs,
      };
      rateLimitStore.set(key, rateData);
    }

    rateData.requests = rateData.requests.filter(timestamp => timestamp > windowStart);

    if (rateData.requests.length >= maxRequests) {
      res.status(429).json({
        success: false,
        error: 'Too many requests',
        message: `Rate limit exceeded: ${maxRequests} requests per ${windowMs / 1000} seconds`,
        retryAfter: Math.ceil((rateData.resetTime - now) / 1000),
      });
      return;
    }

    rateData.requests.push(now);
    next();
  };
};
