import { getDb } from '../clients/mongodb.js';

const WINDOW_MS = {
  last_5m: 5 * 60 * 1000,
  last_15m: 15 * 60 * 1000,
  last_1h: 60 * 60 * 1000,
};

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const toDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const extractEventTime = (event) => {
  // Support legacy timestamp field names without rewriting stored data.
  return toDate(event?.decided_at || event?.created_at || event?.timestamp || event?.createdAt);
};

const extractAction = (event) => {
  if (typeof event?.action === 'string' && event.action.trim().length > 0) return event.action.trim().toUpperCase();
  if (typeof event?.decision === 'string' && event.decision.trim().length > 0) return event.decision.trim().toUpperCase();
  return null;
};

const isAnomalousRisk = (riskLevel) => {
  // The monitor is policy/ops oriented; treat anything non-low as anomalous,
  // but be defensive about missing/unknown values.
  if (typeof riskLevel !== 'string') return false;
  const risk = riskLevel.trim().toLowerCase();
  return risk !== 'low';
};

export const computeWindowStats = (events, windowStartMs) => {
  const windowEvents = events.filter((event) => {
    const t = extractEventTime(event);
    return t && t.getTime() >= windowStartMs;
  });

  const count = windowEvents.length;
  const scores = windowEvents
    .map((e) => e?.score)
    .filter((s) => isFiniteNumber(s));

  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const max = scores.length ? Math.max(...scores) : null;

  const anomalyCount = windowEvents.filter((e) => isAnomalousRisk(e?.risk_level)).length;
  const blockCount = windowEvents.filter((e) => extractAction(e) === 'BLOCK').length;

  const anomalyRatio = count > 0 ? anomalyCount / count : 0;
  const blockRatio = count > 0 ? blockCount / count : 0;

  return {
    count,
    avg_score: avg === null ? null : Number(avg.toFixed(3)),
    max_score: max === null ? null : Number(max.toFixed(3)),
    anomaly_ratio: Number(anomalyRatio.toFixed(2)),
    block_ratio: Number(blockRatio.toFixed(2)),
  };
};

export const computeTrend = (events) => {
  const points = events
    .map((event) => {
      const t = extractEventTime(event);
      const score = event?.score;
      if (!t || !isFiniteNumber(score)) return null;
      return { t: t.getTime(), score };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);

  if (points.length < 2) {
    return { direction: 'stable_normal', score_slope: 0 };
  }

  const first = points[0];
  const last = points[points.length - 1];
  const dtSeconds = Math.max(1, (last.t - first.t) / 1000);
  const slope = (last.score - first.score) / dtSeconds;

  const slopeRounded = Number(slope.toFixed(6));
  const slopeAbs = Math.abs(slopeRounded);

  let direction = 'stable_normal';
  if (slopeAbs < 1e-6) {
    direction = 'stable_normal';
  } else if (slopeRounded > 0) {
    direction = 'increasing';
  } else {
    direction = 'decreasing';
  }

  return { direction, score_slope: slopeRounded };
};

const classifyStateFromWindow = ({ anomaly_ratio, block_ratio }) => {
  if (block_ratio >= 0.6 || anomaly_ratio >= 0.6) return 'persistently_anomalous';
  if (anomaly_ratio >= 0.2) return 'borderline';
  return 'normal';
};

const classifyEventState = (event) => {
  const action = extractAction(event);
  if (action === 'BLOCK') return 'persistently_anomalous';

  const risk = typeof event?.risk_level === 'string' ? event.risk_level.trim().toLowerCase() : null;
  if (risk === 'high') return 'persistently_anomalous';
  if (risk === 'medium' || risk === 'warning') return 'borderline';
  if (risk === 'low') return 'normal';

  const decision = typeof event?.decision === 'string' ? event.decision.trim().toLowerCase() : null;
  if (decision === 'block') return 'persistently_anomalous';
  if (decision === 'delay') return 'borderline';
  if (decision === 'allow') return 'normal';

  return 'normal';
};

const computeSinceFromRun = (events, targetState) => {
  if (!events.length) return null;
  const sorted = events
    .slice()
    .map((e) => ({ e, t: extractEventTime(e) }))
    .filter((x) => x.t)
    .sort((a, b) => b.t.getTime() - a.t.getTime());

  let oldestInRun = null;
  for (const { e, t } of sorted) {
    const st = classifyEventState(e);
    if (st !== targetState) break;
    oldestInRun = t;
  }
  return oldestInRun ? oldestInRun.toISOString() : null;
};

export const computeAnomalyMonitor = ({ deviceId, events, now = new Date() }) => {
  const nowDate = toDate(now) ?? new Date();
  const nowMs = nowDate.getTime();

  const eventsWithTime = events
    .map((event) => ({ event, t: extractEventTime(event) }))
    .filter(({ t }) => t)
    .sort((a, b) => b.t.getTime() - a.t.getTime());

  const latest = eventsWithTime[0]?.event ?? null;
  const latestTime = eventsWithTime[0]?.t ?? null;

  const current = {
    last_score: isFiniteNumber(latest?.score) ? Number(latest.score.toFixed(4)) : null,
    risk_level: typeof latest?.risk_level === 'string' ? latest.risk_level : null,
    action: extractAction(latest),
    last_inferred_at: latestTime ? latestTime.toISOString() : null,
  };

  const last_5m = computeWindowStats(events, nowMs - WINDOW_MS.last_5m);
  const last_15m = computeWindowStats(events, nowMs - WINDOW_MS.last_15m);
  const last_1h = computeWindowStats(events, nowMs - WINDOW_MS.last_1h);

  const trend = (() => {
    const in1h = events.filter((e) => {
      const t = extractEventTime(e);
      return t && t.getTime() >= nowMs - WINDOW_MS.last_1h;
    });
    const base = computeTrend(in1h);
    if (base.direction === 'stable_normal' && (last_15m.anomaly_ratio >= 0.6 || last_15m.block_ratio >= 0.6)) {
      return { ...base, direction: 'stable_high' };
    }
    return base;
  })();

  const state = classifyStateFromWindow(last_15m);
  const since = computeSinceFromRun(
    events.filter((e) => {
      const t = extractEventTime(e);
      return t && t.getTime() >= nowMs - WINDOW_MS.last_1h;
    }),
    state,
  );

  return {
    device_id: deviceId,
    current,
    windows: { last_5m, last_15m, last_1h },
    trend,
    status: { state, since },
  };
};

export const getAnomalyMonitorForDevice = async (deviceId, { now = new Date() } = {}) => {
  const db = await getDb();

  // Best-effort: fetch a limited recent set and filter in memory for window computations.
  const raw = await db
    .collection('anomaly_events')
    .find({ deviceId })
    .sort({ decided_at: -1, created_at: -1, timestamp: -1 })
    .limit(500)
    .toArray();

  return computeAnomalyMonitor({ deviceId, events: raw, now });
};

