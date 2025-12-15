import { getAnomalyAnalysis } from '../services/anomalyService.js';
import { validateDeviceId } from '../utils/validators.js';
import { getDb } from '../clients/mongodb.js';

// ML Ops best practice: Persist anomaly results to DB for consistency
// This ensures Dashboard and Devices list reflect real-time anomaly state
export const getAnomalyHandler = async (req, res, next) => {
  try {
    const deviceId = validateDeviceId(req.params.device_id);
    const result = await getAnomalyAnalysis(deviceId);

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

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

