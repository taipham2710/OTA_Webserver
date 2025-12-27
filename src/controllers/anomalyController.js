import { validateDeviceId } from '../utils/validators.js';
import { getDb } from '../clients/mongodb.js';
import { AppError } from '../utils/errors.js';
import { buildFeatureVector } from '../services/featureAggregationService.js';
import { inferenceProxy } from '../services/inferenceProxyService.js';

// ARCHITECTURE: Read-only endpoint - returns current anomaly state from devices collection
// NO ML inference, NO database writes
// This is the single source of truth for reading current device anomaly state
export const getAnomalyHandler = async (req, res, next) => {
  try {
    const deviceId = validateDeviceId(req.params.device_id);

    // Read current anomaly state from devices collection
    const db = await getDb();
    const device = await db.collection('devices').findOne({ deviceId });

    if (!device) {
      throw new AppError('Device not found', 404);
    }

    // Return current anomaly state only (single source of truth: devices.anomaly)
    // UI must not compute or infer anything.
    const responseData = device.anomaly ?? null;

    res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    next(error);
  }
};

// ARCHITECTURE: Manual analysis endpoint - ML inference without updating production state
// Triggers ML inference but does NOT write to devices collection
export const getAnomalyAnalysisHandler = async (req, res, next) => {
  try {
    const deviceId = validateDeviceId(req.params.device_id);

    // Manual analysis is read-only: no DB writes, no anomaly history writes.
    const featureVector = await buildFeatureVector(deviceId);
    const upstream = await inferenceProxy.predict({ data: featureVector });
    if (!upstream || upstream.status !== 200 || !upstream.data || typeof upstream.data !== 'object') {
      throw new AppError('Inference service unavailable', 503);
    }

    // Return upstream result only (read-only).
    const responseData = {
      deviceId,
      ...upstream.data,
    };

    res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    next(error);
  }
};

// ARCHITECTURE: Production inference endpoint - ML inference with production state update
// This is the ONLY endpoint that can write to devices.anomaly and anomaly_events.
// Updates operational state for system use
export const postAnomalyInferHandler = async (req, res, next) => {
  try {
    const deviceId = validateDeviceId(req.params.device_id);

    // Ensure device exists before doing any expensive aggregation/inference
    const db = await getDb();
    const device = await db.collection('devices').findOne({ deviceId });
    if (!device) {
      throw new AppError('Device not found', 404);
    }

    // 1) Aggregate features (existing logic)
    const featureVector = await buildFeatureVector(deviceId);

    // 2) Call inference service (authoritative)
    const upstream = await inferenceProxy.predict({ data: featureVector });
    if (!upstream || upstream.status !== 200 || !upstream.data || typeof upstream.data !== 'object') {
      throw new AppError('Inference service unavailable', 503);
    }

    // NEW inference contract (authoritative):
    // { anomaly_score, risk_level, threshold, soft_threshold, ... }
    const score = upstream.data.anomaly_score;
    const threshold = upstream.data.threshold;
    const softThreshold = upstream.data.soft_threshold;
    const risk_level = upstream.data.risk_level;

    if (
      typeof score !== 'number' ||
      typeof threshold !== 'number' ||
      typeof softThreshold !== 'number'
    ) {
      throw new AppError('Invalid inference response', 502);
    }

    // 3) Apply decision logic (strict 2-threshold policy)
    let decision;
    if (score >= threshold) {
      decision = 'block';
    } else if (score >= softThreshold) {
      decision = 'delay';
    } else {
      decision = 'allow';
    }

    const now = new Date();
    const anomalyState = {
      score,
      risk_level: typeof risk_level === 'string' ? risk_level : null,
      decision,
      threshold,
      soft_threshold: softThreshold,
      updated_at: now,
    };

    // Persist current anomaly state ONLY in devices.anomaly
    const updateResult = await db.collection('devices').updateOne(
      { deviceId },
      { $set: { anomaly: anomalyState } },
      { upsert: false },
    );
    if (updateResult.matchedCount === 0) {
      throw new AppError('Device not found', 404);
    }

    // Insert ONE record into anomaly_events per inference.
    await db.collection('anomaly_events').insertOne({
      deviceId,
      score,
      risk_level: anomalyState.risk_level,
      decision,
      threshold,
      soft_threshold: softThreshold,
      decided_at: now,
      source: 'ml-inference',
    });

    res.json({
      success: true,
      data: {
        deviceId,
        score,
        risk_level: anomalyState.risk_level,
        decision,
        threshold,
        soft_threshold: softThreshold,

        // Backward-compatible aliases for existing UI (read-only display)
        action: decision.toUpperCase(),
        thresholds: { hard: threshold, soft: softThreshold },
      },
    });

  } catch (error) {
    next(error);
  }
};

// Get anomalies history for a device
// CRITICAL ARCHITECTURE RULE:
// - This endpoint returns HISTORY ONLY (immutable events from anomaly_events collection)
// - It does NOT return current anomaly state
// - It does NOT compute or derive current state from history
// - Current anomaly state comes ONLY from GET /api/devices/:id (devices collection)
export const getAnomaliesHistoryHandler = async (req, res, next) => {
  try {
    const deviceId = validateDeviceId(req.params.deviceId || req.params.device_id);
    const { limit = 50 } = req.query;

    const db = await getDb();

    // LEGACY — anomalies collection is deprecated
    // History must come from anomaly_events only.
    const events = await db.collection('anomaly_events')
      .find({ deviceId })
      .sort({ decided_at: -1 }) // Most recent first
      .limit(parseInt(limit, 10))
      .toArray();

    res.json({
      success: true,
      data: events.map((event) => {
        const threshold = event?.threshold;
        const softThreshold = event?.soft_threshold;
        const decision = event?.decision;

        return {
          ...event,
          // Backward-compatible aliases for existing UI (read-only display)
          action: typeof event?.action === 'string' ? event.action : (typeof decision === 'string' ? decision.toUpperCase() : undefined),
          hard_threshold: typeof event?.hard_threshold === 'number' ? event.hard_threshold : (typeof threshold === 'number' ? threshold : undefined),
          soft_threshold: typeof softThreshold === 'number' ? softThreshold : event?.soft_threshold,
        };
      }),
      count: events.length,
    });
  } catch (error) {
    next(error);
  }
};