import { getDb } from '../clients/mongodb.js';

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const toDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const extractEventTime = (event) => {
  // Support legacy timestamp field names without rewriting stored data.
  return toDate(event?.decided_at || event?.created_at || event?.timestamp);
};

const extractAction = (event) => {
  if (typeof event?.action === 'string' && event.action.trim().length > 0) return event.action.trim().toUpperCase();
  if (typeof event?.decision === 'string' && event.decision.trim().length > 0) return event.decision.trim().toUpperCase();
  return null;
};

const computeScoreSlope = (events) => {
  const points = events
    .map((event) => {
      const t = extractEventTime(event);
      const score = event?.score;
      if (!t || !isFiniteNumber(score)) return null;
      return { t: t.getTime(), score };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);

  if (points.length < 2) return 0;

  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / (1000 * 60 * 60 * 24)); // days since first point
  const ys = points.map((p) => p.score);

  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX;
    num += dx * (ys[i] - meanY);
    den += dx * dx;
  }

  if (den <= 0) return 0;
  return num / den;
};

export const computeAnomalyHistorySummary = ({ deviceId, events, now = new Date() }) => {
  // This summary exists to support human operators.
  // It provides historical context, not decisions.
  // Operational safety decisions remain exclusively with the inference service.
  const nowDate = toDate(now) ?? new Date();
  const nowMs = nowDate.getTime();

  const last24hStart = nowMs - 24 * 60 * 60 * 1000;
  const last7dStart = nowMs - 7 * 24 * 60 * 60 * 1000;

  const last24h = events.filter((e) => {
    const t = extractEventTime(e);
    return t && t.getTime() >= last24hStart;
  });

  const blockCount = last24h.filter((e) => extractAction(e) === 'BLOCK').length;
  const total24h = last24h.length;

  const last7d = events.filter((e) => {
    const t = extractEventTime(e);
    return t && t.getTime() >= last7dStart;
  });

  const slope = computeScoreSlope(last7d);
  const scoreSlope = Number(slope.toFixed(6));

  const EPS = 1e-6;
  const direction =
    scoreSlope > EPS ? 'degrading' : scoreSlope < -EPS ? 'improving' : 'stable';

  return {
    device_id: deviceId,
    summary: {
      last_24h: {
        block_count: blockCount,
        total_events: total24h,
      },
      trend_7d: {
        direction,
        score_slope: scoreSlope,
      },
    },
  };
};

export const getAnomalyHistorySummaryForDevice = async (deviceId, { now = new Date() } = {}) => {
  const db = await getDb();

  // Best-effort: fetch a limited recent set and filter in memory.
  const events = await db
    .collection('anomaly_events')
    .find({ deviceId })
    .sort({ decided_at: -1, created_at: -1, timestamp: -1 })
    .limit(5000)
    .toArray();

  return computeAnomalyHistorySummary({ deviceId, events, now });
};
