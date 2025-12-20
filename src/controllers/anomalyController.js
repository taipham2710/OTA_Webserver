import { getAnomalyAnalysis } from '../services/anomalyService.js';
import { validateDeviceId } from '../utils/validators.js';
import { getDb } from '../clients/mongodb.js';
import { buildAnomalyExplanations } from '../services/anomalyExplanationService.js';
import { buildOTARecommendation } from '../services/otaDecisionService.js';
import { AppError } from '../utils/errors.js';

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

    // Return current state only - no inference, no writes
    const responseData = {
      isAnomaly: device.isAnomaly === true,
      anomalyScore: device.anomalyScore ?? null,
      anomalyThreshold: device.anomalyThreshold ?? null,
      anomalyUpdatedAt: device.anomalyUpdatedAt ? device.anomalyUpdatedAt.toISOString() : null,
      source: device.anomalyUpdatedAt ? 'production' : null,
    };

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
// May optionally write to anomalies collection with source='manual' for audit trail
export const getAnomalyAnalysisHandler = async (req, res, next) => {
  try {
    const deviceId = validateDeviceId(req.params.device_id);
    const { writeAudit = 'false' } = req.query;
    const shouldWriteAudit = writeAudit === 'true' || writeAudit === true;

    // Perform ML inference
    const result = await getAnomalyAnalysis(deviceId);

    // Build explanations and OTA recommendation from features
    const explanations = buildAnomalyExplanations(result.features || {});
    const otaRecommendation = buildOTARecommendation(explanations);

    // CRITICAL: Do NOT write to devices collection
    // Manual analysis must not affect production state

    // Optionally write to anomalies collection for audit trail (if writeAudit=true)
    if (shouldWriteAudit && result.isAnomaly === true) {
      try {
        const db = await getDb();
        await db.collection('anomalies').insertOne({
          deviceId,
          timestamp: new Date(),
          anomalyScore: result.anomalyScore,
          threshold: result.threshold,
          label: 'anomaly',
          source: 'manual', // Distinguish from production inference
          explanations,
          otaRecommendation,
          model: result.model || {
            name: 'xgboost',
            version: 'v1.0',
            thresholdSource: 'default',
          },
          createdAt: new Date(),
        });
      } catch (eventError) {
        // Log error but don't fail the request
        console.warn(`Failed to write manual analysis event to DB for device ${deviceId}: ${eventError.message}`);
      }
    }

    // Include explanations and OTA recommendation in response
    const responseData = {
      ...result,
      explanations,
      otaRecommendation,
      source: 'manual',
      timestamp: new Date().toISOString(),
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
// This is the ONLY endpoint that can write to devices.isAnomaly
// Updates operational state for system use
export const postAnomalyInferHandler = async (req, res, next) => {
  try {
    const deviceId = validateDeviceId(req.params.device_id);

    // Perform ML inference
    const result = await getAnomalyAnalysis(deviceId);

    // Build explanations and OTA recommendation from features
    const explanations = buildAnomalyExplanations(result.features || {});
    const otaRecommendation = buildOTARecommendation(explanations);

    // CRITICAL: Write to devices collection - this is the single source of truth
    // Only this endpoint can update devices.isAnomaly
    try {
      const db = await getDb();
      await db.collection('devices').updateOne(
        { deviceId },
        {
          $set: {
            anomalyScore: result.anomalyScore,
            anomalyThreshold: result.threshold,
            isAnomaly: result.isAnomaly,
            anomalyUpdatedAt: new Date(),
          },
        },
        { upsert: false } // Only update if device exists
      );
    } catch (dbError) {
      // Log error but don't fail the request
      console.warn(`Failed to persist anomaly result to DB for device ${deviceId}: ${dbError.message}`);
    }

    // Write anomaly event to anomalies collection when anomaly is detected
    // Only write when isAnomaly === true to avoid DB spam
    if (result.isAnomaly === true) {
      try {
        const db = await getDb();
        await db.collection('anomalies').insertOne({
          deviceId,
          timestamp: new Date(),
          anomalyScore: result.anomalyScore,
          threshold: result.threshold,
          label: 'anomaly',
          source: 'production', // Distinguish from manual analysis
          explanations,
          otaRecommendation,
          model: result.model || {
            name: 'xgboost',
            version: 'v1.0',
            thresholdSource: 'default',
          },
          createdAt: new Date(),
        });
      } catch (eventError) {
        // Log error but don't fail the request
        console.warn(`Failed to write anomaly event to DB for device ${deviceId}: ${eventError.message}`);
      }
    }

    // Include explanations and OTA recommendation in response
    const responseData = {
      ...result,
      explanations,
      otaRecommendation,
      source: 'production',
      updatedAt: new Date().toISOString(),
    };

    res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    next(error);
  }
};

// Get anomalies history for a device
// CRITICAL ARCHITECTURE RULE:
// - This endpoint returns HISTORY ONLY (immutable events from anomalies collection)
// - It does NOT return current anomaly state
// - It does NOT compute or derive current state from history
// - Current anomaly state comes ONLY from GET /api/devices/:id (devices collection)
export const getAnomaliesHistoryHandler = async (req, res, next) => {
  try {
    const deviceId = validateDeviceId(req.params.deviceId || req.params.device_id);
    const { limit = 50 } = req.query;

    const db = await getDb();
    // CRITICAL: Return raw history only - no aggregation, no derived state
    const anomalies = await db.collection('anomalies')
      .find({ deviceId })
      .sort({ timestamp: -1 }) // Most recent first
      .limit(parseInt(limit, 10))
      .toArray();

    res.json({
      success: true,
      data: anomalies,
      count: anomalies.length,
    });
  } catch (error) {
    next(error);
  }
};