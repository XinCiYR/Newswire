// Simple in-memory sliding-window rate limiter (per key/IP). Good enough for
// auth + cron endpoints; swap for a shared store (Redis) when scaling out.

export function rateLimit({ windowMs = 60000, max = 10, keyFn = (req) => req.ip }) {
  // Each limiter has its own counters (cron traffic must not exhaust auth).
  const buckets = new Map();
  let nextSweep = 0;
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    if (now >= nextSweep) {
      for (const [key, record] of buckets) if (record.reset <= now) buckets.delete(key);
      nextSweep = now + windowMs;
    }
    let rec = buckets.get(key);
    if (!rec || rec.reset <= now) {
      rec = { count: 0, reset: now + windowMs };
      buckets.set(key, rec);
    }
    rec.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - rec.count)));
    if (rec.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((rec.reset - now) / 1000))));
      return res.status(429).json({ error: 'Too many requests. Please try again in a moment.' });
    }
    next();
  };
}
