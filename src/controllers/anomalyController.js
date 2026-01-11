import { validateDeviceId } from '../utils/validators.js';
import { getDb } from '../clients/mongodb.js';
import { AppError } from '../utils/errors.js';
import { buildFeatureVectorCountBased } from '../services/featureAggregationService.js';
import { inferenceProxy } from '../services/inferenceProxyService.js';
import { otaPolicyDecision } from '../policy/policyEngine.js';

const isMlContractViolation = (error) =>
  Boolean(error && typeof error.message === 'string' && error.message.startsWith('ML_CONTRACT_VIOLATION'));

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
    let featureVector;
    try {
      featureVector = await buildFeatureVectorCountBased(deviceId);
    } catch (error) {
      if (isMlContractViolation(error)) {
        res.status(400).json({
          success: false,
          errorCode: 'ML_CONTRACT_VIOLATION',
          message: error.message,
          statusCode: 400,
        });
        return;
      }
      throw error;
    }

    const nonZeroFeatureCount = Object.entries(featureVector)
      .filter(([k]) => !k.endsWith('_present'))
      .filter(([, v]) => Number.isFinite(v) && v !== 0)
      .length;
    if (nonZeroFeatureCount < 5) {
      console.warn('[ML_ASSERT] Too few non-zero features for inference', { deviceId, nonZeroFeatureCount });
    }
    const allPresentZero = Object.entries(featureVector)
      .filter(([k]) => k.endsWith('_present'))
      .every(([, v]) => v === 0);
    if (allPresentZero) {
      console.error('[ML_ASSERT] All *_present flags are 0 → invalid feature vector', { deviceId });
    }

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

    // 1) Aggregate features (ML training contract: count-based window, ordered feature list)
    let featureVector;
    try {
      featureVector = await buildFeatureVectorCountBased(deviceId);
    } catch (error) {
      if (isMlContractViolation(error)) {
        // HARD FAIL on contract violation: do not update device state, do not insert events.
        res.status(400).json({
          success: false,
          errorCode: 'ML_CONTRACT_VIOLATION',
          message: error.message,
          statusCode: 400,
        });
        return;
      }
      throw error;
    }

    // DEBUG (guarded): verify vector contract without logging full payload.
    if (String(process.env.DEBUG_ML || '') === '1') {
      const entries = Object.entries(featureVector);
      const featureCount = entries.length;
      const nonZeroCount = entries
        .filter(([k]) => !k.endsWith('_present'))
        .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v !== 0)
        .length;
      const timeGapAvg = typeof featureVector.time_gap_avg === 'number' ? featureVector.time_gap_avg : null;
      const timeGapStd = typeof featureVector.time_gap_std === 'number' ? featureVector.time_gap_std : null;
      const sample = entries.slice(0, 10);
      console.log(
        `[ML_VECTOR_DEBUG] deviceId=${deviceId} featureCount=${featureCount} nonZeroCount=${nonZeroCount} time_gap_avg=${timeGapAvg} time_gap_std=${timeGapStd} sample=${JSON.stringify(sample)}`,
      );
    }

    const nonZeroFeatureCount = Object.entries(featureVector)
      .filter(([k]) => !k.endsWith('_present'))
      .filter(([, v]) => Number.isFinite(v) && v !== 0)
      .length;
    if (nonZeroFeatureCount < 5) {
      console.warn('[ML_ASSERT] Too few non-zero features for inference', { deviceId, nonZeroFeatureCount });
    }
    const allPresentZero = Object.entries(featureVector)
      .filter(([k]) => k.endsWith('_present'))
      .every(([, v]) => v === 0);
    if (allPresentZero) {
      console.error('[ML_ASSERT] All *_present flags are 0 → invalid feature vector', { deviceId });
    }

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

    // 3) Validate risk_level format
    if (typeof risk_level !== 'string' || !['low', 'medium', 'high'].includes(risk_level)) {
      throw new AppError('Invalid inference response', 502);
    }

    // 4) Delegate OTA decision to policy engine (separation of concerns)
    const policyResult = otaPolicyDecision(risk_level);
    const decision = policyResult.decision;

    const now = new Date();
    const anomalyState = {
      score,
      risk_level,
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
