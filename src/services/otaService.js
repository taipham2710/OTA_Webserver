import { getDb } from '../clients/mongodb.js';
import { AppError } from '../utils/errors.js';
import { getAnomalyAnalysis } from './anomalyService.js';
import { buildAnomalyExplanations } from './anomalyExplanationService.js';
import { buildOTARecommendation } from './otaDecisionService.js';
import { logOTAEvent } from './otaEventService.js';

/**
 * Assign firmware to multiple devices using the new device.firmware{} schema
 * @param {Object} assignmentData - { deviceIds: string[], firmwareVersion: string }
 * @returns {Object} - { assigned: number, failed: number, results: Array }
 */
export const assignOTA = async (assignmentData) => {
  try {
    const { deviceIds, firmwareVersion } = assignmentData;

    if (!deviceIds || !Array.isArray(deviceIds) || deviceIds.length === 0) {
      throw new AppError('deviceIds array is required and must not be empty', 400);
    }

    if (!firmwareVersion || typeof firmwareVersion !== 'string') {
      throw new AppError('firmwareVersion is required', 400);
    }

    const db = await getDb();
    const firmwaresCollection = db.collection('firmwares');
    const devicesCollection = db.collection('devices');

    // Verify firmware exists
    const firmware = await firmwaresCollection.findOne({ version: firmwareVersion });
    if (!firmware) {
      throw new AppError('Firmware version not found', 404);
    }

    // Get firmware deviceType (required for matching)
    const firmwareDeviceType = firmware.deviceType || firmware.metadata?.deviceType;
    if (!firmwareDeviceType) {
      throw new AppError('Firmware deviceType is missing', 400);
    }

    const results = [];
    let assignedCount = 0;
    let failedCount = 0;

    // Process each device
    for (const deviceId of deviceIds) {
      try {
        const normalizedDeviceId = String(deviceId).trim();

        // Find device by deviceId
        let device = await devicesCollection.findOne({ deviceId: normalizedDeviceId });

        if (!device) {
          // Try case-insensitive regex search as fallback
          device = await devicesCollection.findOne({
            deviceId: {
              $regex: `^\\s*${normalizedDeviceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
              $options: 'i',
            },
          });
        }

        if (!device) {
          results.push({
            deviceId: normalizedDeviceId,
            success: false,
            error: 'Device not found',
          });
          failedCount++;
          continue;
        }

        // Match device model with firmware deviceType
        const deviceModel = device.model || device.deviceType;
        if (deviceModel !== firmwareDeviceType) {
          results.push({
            deviceId: normalizedDeviceId,
            success: false,
            error: `Device model "${deviceModel}" does not match firmware deviceType "${firmwareDeviceType}"`,
          });
          failedCount++;
          continue;
        }

        // Get current firmware version (if exists) - ONLY from device.firmware{}
        const currentVersion = device.firmware?.currentVersion || null;
        const currentFirmwareStatus = device.firmware?.status || 'idle';

        // ========================================================================
        // STATE CONSISTENCY GUARDS
        // ========================================================================
        // Guard 1: Cannot assign firmware older than currentVersion
        // NOTE: Using simple string comparison. For semantic versions (e.g., "1.10.0" vs "1.2.0"),
        // this may not work correctly. Consider using a semver library if versions follow semantic versioning.
        if (currentVersion && firmwareVersion < currentVersion) {
          results.push({
            deviceId: normalizedDeviceId,
            success: false,
            error: `Cannot assign firmware version ${firmwareVersion} older than current version ${currentVersion}`,
          });
          failedCount++;
          continue;
        }

        // Guard 2: Cannot assign if status = updating
        if (currentFirmwareStatus === 'updating') {
          results.push({
            deviceId: normalizedDeviceId,
            success: false,
            error: 'Cannot assign firmware while device is updating',
          });
          failedCount++;
          continue;
        }

        // ========================================================================
        // OTA DECISION ENFORCEMENT
        // ========================================================================
        let otaDecision = { action: 'delay' }; // Default to delay if decision cannot be obtained (fail-closed)
        try {
          // Get anomaly analysis and OTA recommendation
          const anomalyAnalysis = await getAnomalyAnalysis(normalizedDeviceId);
          const explanations = buildAnomalyExplanations(anomalyAnalysis.features || {});
          otaDecision = buildOTARecommendation(explanations);
        } catch (decisionError) {
          // If decision cannot be obtained, log warning and use fail-closed default (delay)
          console.warn(`Failed to get OTA decision for device ${normalizedDeviceId}: ${decisionError.message}`);
        }

        // Enforce decision
        if (otaDecision.action === 'block') {
          results.push({
            deviceId: normalizedDeviceId,
            success: false,
            error: `OTA assignment blocked: ${otaDecision.reason?.join(', ') || 'Anomaly detected'}`,
          });
          failedCount++;
          continue;
        }

        // ========================================================================
        // LOG OTA EVENT (assign)
        // ========================================================================
        await logOTAEvent({
          deviceId: normalizedDeviceId,
          firmwareVersion: firmware.version,
          action: 'assign',
          source: 'admin',
          reason: otaDecision.action === 'delay' 
            ? `OTA delayed: ${otaDecision.reason?.join(', ') || 'Device unstable'}` 
            : null,
          metadata: {
            decision: otaDecision.action,
            confidence: otaDecision.confidence,
          },
        });

        // ========================================================================
        // UPDATE DEVICE STATE
        // ========================================================================
        // Decision enforcement: delay → "pending", allow → "assigned"
        const firmwareStatus = otaDecision.action === 'delay' ? 'pending' : 'assigned';

        const updateResult = await devicesCollection.updateOne(
          { deviceId: normalizedDeviceId },
          {
            $set: {
              'firmware.desiredVersion': firmware.version,
              'firmware.status': firmwareStatus,
              'firmware.assignedAt': new Date(),
              updatedAt: new Date(),
            },
            // Only set currentVersion if it doesn't exist
            $setOnInsert: {
              'firmware.currentVersion': currentVersion,
            },
          }
        );

        if (updateResult.matchedCount === 0) {
          results.push({
            deviceId: normalizedDeviceId,
            success: false,
            error: 'Device update failed',
          });
          failedCount++;
          continue;
        }

        results.push({
          deviceId: normalizedDeviceId,
          success: true,
          firmwareVersion: firmware.version,
        });
        assignedCount++;
      } catch (error) {
        results.push({
          deviceId: String(deviceId),
          success: false,
          error: error.message || 'Unknown error',
        });
        failedCount++;
      }
    }

    return {
      assigned: assignedCount,
      failed: failedCount,
      results,
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw new AppError(`Failed to assign OTA: ${error.message}`, 500);
  }
};

export const deployOTA = async (deploymentData) => {
  try {
    const db = await getDb();
    const collection = db.collection('deployments');

    const deployment = {
      ...deploymentData,
      createdAt: new Date(),
      status: 'pending',
    };

    const result = await collection.insertOne(deployment);

    return {
      id: result.insertedId.toString(),
      ...deployment,
    };
  } catch (error) {
    throw new AppError(`Failed to deploy OTA: ${error.message}`, 500);
  }
};

export const getDeployments = async (queryParams = {}) => {
  try {
    const db = await getDb();
    const collection = db.collection('deployments');

    const { deviceId, status, limit = 100 } = queryParams;
    const filter = {};

    if (deviceId) filter.deviceId = deviceId;
    if (status) filter.status = status;

    const deployments = await collection
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return deployments;
  } catch (error) {
    throw new AppError(`Failed to get deployments: ${error.message}`, 500);
  }
};

export const getOTAHistory = async (deviceId) => {
  try {
    const db = await getDb();
    const collection = db.collection('ota_history');

    const history = await collection
      .find({ deviceId })
      .sort({ deployedAt: -1 })
      .toArray();

    return history.map(item => ({
      id: item._id.toString(),
      deviceId: item.deviceId,
      firmwareVersion: item.firmwareVersion,
      firmwareUrl: item.firmwareUrl,
      status: item.status,
      deployedAt: item.deployedAt,
      completedAt: item.completedAt,
      error: item.error,
      _id: undefined,
    }));
  } catch (error) {
    throw new AppError(`Failed to get OTA history: ${error.message}`, 500);
  }
};