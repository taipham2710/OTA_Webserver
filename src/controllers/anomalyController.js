import { getAnomalyAnalysis } from '../services/anomalyService.js';
import { validateDeviceId } from '../utils/validators.js';
import { getDb } from '../clients/mongodb.js';
import { buildAnomalyExplanations } from '../services/anomalyExplanationService.js';
import { buildOTARecommendation } from '../services/otaDecisionService.js';

// ML Ops best practice: Persist anomaly results to DB for consistency
// This ensures Dashboard and Devices list reflect real-time anomaly state
export const getAnomalyHandler = async (req, res, next) => {
  try {
    const deviceId = validateDeviceId(req.params.device_id);
    const result = await getAnomalyAnalysis(deviceId);

    // Build explanations and OTA recommendation from features
    const explanations = buildAnomalyExplanations(result.features || {});
    const otaRecommendation = buildOTARecommendation(explanations);

    // Persist anomaly result to MongoDB devices collection
    // This is MANDATORY so Dashboard and Devices list stay in sync
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
      // Anomaly computation succeeded, DB update is secondary
      console.warn(`Failed to persist anomaly result to DB for device ${deviceId}: ${dbError.message}`);
    }

    // Hook: Write anomaly event to anomalies collection when anomaly is detected
    // Only write when isAnomaly === true to avoid DB spam
    if (result.isAnomaly === true) {
      try {
        const db = await getDb();
        await db.collection('anomalies').insertOne({
          deviceId,
          timestamp: new Date(),               // thời điểm phát hiện (không phải log timestamp)
          anomalyScore: result.anomalyScore,
          threshold: result.threshold,
          label: 'anomaly',
          source: 'ml-inference',
          explanations,                        // Array of explanations (chỉ chứa evidence, không phải full 83 features)
          otaRecommendation,                   // Recommendation only, không phải auto-action
          model: result.model || {             // Model metadata for MLOps traceability
            name: 'xgboost',
            version: 'v1.0',
            thresholdSource: 'default',
          },
          createdAt: new Date(),
        });
      } catch (eventError) {
        // Log error but don't fail the request
        // Event logging is secondary to inference result
        console.warn(`Failed to write anomaly event to DB for device ${deviceId}: ${eventError.message}`);
      }
    }

    // Include explanations and OTA recommendation in response
    const responseData = {
      ...result,
      explanations,
      otaRecommendation,
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
export const getAnomaliesHistoryHandler = async (req, res, next) => {
  try {
    const deviceId = validateDeviceId(req.params.deviceId || req.params.device_id);
    const { limit = 50 } = req.query;

    const db = await getDb();
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
