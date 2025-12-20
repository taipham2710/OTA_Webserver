import { getDb } from '../clients/mongodb.js';
import { getElasticsearchClient } from '../clients/elasticsearch.js';
import { getQueryApi } from '../clients/influxdb.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import { logOTAEvent } from './otaEventService.js';
import { getAnomalyAnalysis } from './anomalyService.js';
import { buildAnomalyExplanations } from './anomalyExplanationService.js';
import { buildOTARecommendation } from './otaDecisionService.js';

// Helper: Get last log timestamp from Elasticsearch
const getLastLogTimestamp = async (deviceId) => {
  try {
    const esClient = getElasticsearchClient();
    const res = await esClient.search({
      index: 'logs-iot',
      size: 1,
      body: {
        query: {
          term: { 'deviceId.keyword': deviceId },
        },
        sort: [{ '@timestamp': { order: 'desc' } }],
      },
    });

    const hit = res?.hits?.hits?.[0];
    return hit ? new Date(hit._source['@timestamp']) : null;
  } catch {
    return null;
  }
};

// Helper: Get last metric timestamp from InfluxDB
const getLastMetricTimestamp = async (deviceId) => {
  try {
    const queryApi = getQueryApi();
    const fluxQuery = `
      from(bucket: "${config.influx.bucket}")
        |> range(start: -7d)
        |> filter(fn: (r) => r.device_id == "${deviceId}")
        |> sort(columns: ["_time"], desc: true)
        |> limit(n: 1)
    `;

    let lastTime = null;
    await new Promise((resolve, reject) => {
      queryApi.queryRows(fluxQuery, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          lastTime = new Date(o._time);
        },
        error: reject,
        complete: resolve,
      });
    });

    return lastTime;
  } catch {
    return null;
  }
};

export const getDevices = async (queryParams = {}) => {
  try {
    const db = await getDb();
    const collection = db.collection('devices');

    const { status, limit = 100, skip = 0 } = queryParams;
    const filter = {};

    if (status) filter.status = status;

    const devices = await collection
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .toArray();

    const now = Date.now();
    const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

    const enrichedDevices = await Promise.all(
      devices.map(async (device) => {
        const deviceId = device.deviceId;

        const lastLogTime = await getLastLogTimestamp(deviceId);
        const lastMetricTime = await getLastMetricTimestamp(deviceId);

        let lastSeenAt = device.lastSeenAt
          ? new Date(device.lastSeenAt)
          : null;

        if (lastLogTime && (!lastSeenAt || lastLogTime > lastSeenAt)) {
          lastSeenAt = lastLogTime;
        }
        if (lastMetricTime && (!lastSeenAt || lastMetricTime > lastSeenAt)) {
          lastSeenAt = lastMetricTime;
        }

        const computedStatus =
          lastSeenAt && now - lastSeenAt.getTime() < ONLINE_THRESHOLD_MS
            ? 'active'
            : 'inactive';

        // Normalize OTA fields from device.firmware{} schema
        const otaStatus = device.firmware?.status || 'idle';
        const firmwareVersion = device.firmware?.currentVersion || null;

        // Read anomaly state from devices collection (single source of truth)
        // DO NOT compute anomaly here - it's updated by anomalyController after ML inference
        const isAnomaly = device.isAnomaly === true;
        const anomalyScore = device.anomalyScore ?? null;
        const anomalyThreshold = device.anomalyThreshold ?? null;
        const anomalyUpdatedAt = device.anomalyUpdatedAt ?? null;

        // Destructure to exclude legacy fields
        const {
          otaStatus: _legacyOtaStatus,
          firmwareVersion: _legacyFirmwareVersion,
          targetFirmwareVersion: _legacyTargetFirmwareVersion,
          firmwareAssignedAt: _legacyFirmwareAssignedAt,
          ...deviceWithoutLegacy
        } = device;

        return {
          id: device._id.toString(),
          ...deviceWithoutLegacy,
          lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : (device.lastSeenAt || device.createdAt || new Date()).toISOString(),
          status: computedStatus,
          // Normalized OTA fields (derived from device.firmware{})
          otaStatus,
          firmwareVersion,
          // Anomaly state (read from devices collection, single source of truth)
          isAnomaly,
          anomalyScore,
          anomalyThreshold,
          anomalyUpdatedAt,
          _id: undefined,
        };
      })
    );

    return enrichedDevices;
  } catch (error) {
    throw new AppError(`Failed to get devices: ${error.message}`, 500);
  }
};

export const getDeviceById = async (deviceId) => {
  try {
    const db = await getDb();
    const collection = db.collection('devices');

    const device = await collection.findOne({ deviceId });

    if (!device) {
      throw new AppError('Device not found', 404);
    }

    // Normalize OTA fields from device.firmware{} schema
    const otaStatus = device.firmware?.status || 'idle';
    const firmwareVersion = device.firmware?.currentVersion || null;

    // Destructure to exclude legacy fields
    const {
      otaStatus: _legacyOtaStatus,
      firmwareVersion: _legacyFirmwareVersion,
      targetFirmwareVersion: _legacyTargetFirmwareVersion,
      firmwareAssignedAt: _legacyFirmwareAssignedAt,
      ...deviceWithoutLegacy
    } = device;

    const deviceData = {
      id: device._id.toString(),
      ...deviceWithoutLegacy,
      // Normalized OTA fields (derived from device.firmware{})
      otaStatus,
      firmwareVersion,
      _id: undefined,
    };

    // Get recent logs count from Elasticsearch
    try {
      const esClient = getElasticsearchClient();
      const logResponse = await esClient.count({
        index: 'logs-iot',
        body: {
          query: {
            term: { deviceId: deviceId },
          },
        },
      });
      // Elasticsearch v8 client returns count directly (not response.body.count)
      deviceData.logCount = logResponse?.count ?? logResponse?.body?.count ?? 0;
    } catch (error) {
      deviceData.logCount = 0;
    }

    // Get recent metrics count from InfluxDB
    try {
      const queryApi = getQueryApi();
      const fluxQuery = `from(bucket: "${config.influx.bucket}")
        |> range(start: -24h)
        |> filter(fn: (r) => r.device_id == "${deviceId}")
        |> count()`;

      let metricCount = 0;
      await new Promise((resolve, reject) => {
        queryApi.queryRows(fluxQuery, {
          next(row) {
            metricCount++;
          },
          error(err) {
            reject(err);
          },
          complete() {
            resolve();
          },
        });
      });
      deviceData.metricCount = metricCount;
    } catch (error) {
      deviceData.metricCount = 0;
    }

    // Read anomaly state from devices collection (single source of truth)
    // DO NOT compute anomaly here - it's updated by anomalyController after ML inference
    deviceData.isAnomaly = device.isAnomaly === true;
    deviceData.anomalyScore = device.anomalyScore ?? null;
    deviceData.anomalyThreshold = device.anomalyThreshold ?? null;
    deviceData.anomalyUpdatedAt = device.anomalyUpdatedAt ?? null;

    // ===== Compute runtime lastSeen & status =====
    const lastLogTime = await getLastLogTimestamp(deviceId);
    const lastMetricTime = await getLastMetricTimestamp(deviceId);

    let lastSeenAt = device.lastSeenAt ? new Date(device.lastSeenAt) : null;

    if (lastLogTime && (!lastSeenAt || lastLogTime > lastSeenAt)) {
      lastSeenAt = lastLogTime;
    }
    if (lastMetricTime && (!lastSeenAt || lastMetricTime > lastSeenAt)) {
      lastSeenAt = lastMetricTime;
    }

    deviceData.lastSeenAt = lastSeenAt;

    const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
    deviceData.status =
      lastSeenAt && Date.now() - lastSeenAt.getTime() < ONLINE_THRESHOLD_MS
        ? 'active'
        : 'inactive';

    return deviceData;
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw new AppError(`Failed to get device: ${error.message}`, 500);
  }
};

export const assignFirmwareToDevice = async (deviceId, firmwareVersion) => {
  console.log('--- deviceService.assignFirmwareToDevice called with: ---');
  console.log('Device ID:', deviceId);
  console.log('Device ID type:', typeof deviceId);
  console.log('Device ID value (stringified):', JSON.stringify(deviceId));
  console.log('Firmware Version:', firmwareVersion);
  try {
    const normalizedDeviceId = String(deviceId).trim();
    console.log('Normalized deviceId:', normalizedDeviceId);

    const db = await getDb();
    const devicesCollection = db.collection('devices');
    const firmwaresCollection = db.collection('firmwares');

    console.log('Database name:', db.databaseName);
    console.log('Collection name: devices');

    console.log('Checking firmware existence with version:', firmwareVersion);
    const firmware = await firmwaresCollection.findOne({ version: firmwareVersion });
    if (!firmware) {
      console.log('Firmware not found with version:', firmwareVersion);
      throw new AppError('Firmware version not found', 404);
    }
    console.log('Firmware found:', firmware.version);

    console.log('Searching for device with deviceId:', normalizedDeviceId);
    let device = await devicesCollection.findOne({ deviceId: normalizedDeviceId });

    if (!device) {
      device = await devicesCollection.findOne({
        deviceId: { $regex: `^\\s*${normalizedDeviceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, $options: 'i' }
      });
    }

    if (!device) {
      console.log('Device not found with deviceId:', normalizedDeviceId);
      const allDevices = await devicesCollection.find({}).limit(5).toArray();
      console.log('Sample devices in collection (first 5):', allDevices.map(d => ({
        _id: d._id?.toString(),
        deviceId: d.deviceId,
        deviceIdType: typeof d.deviceId
      })));
      throw new AppError('Device not found', 404);
    }

    console.log('Device found, updating...');
    const query = { deviceId: normalizedDeviceId };
    console.log('Query filter:', query);

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
      throw new AppError(`Cannot assign firmware version ${firmwareVersion} older than current version ${currentVersion}`, 400);
    }

    // Guard 2: Cannot assign if status = updating
    if (currentFirmwareStatus === 'updating') {
      throw new AppError('Cannot assign firmware while device is updating', 400);
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
      throw new AppError(`OTA assignment blocked: ${otaDecision.reason?.join(', ') || 'Anomaly detected'}`, 403);
    }

    // ========================================================================
    // LOG OTA EVENT (assign)
    // ========================================================================
    await logOTAEvent({
      deviceId: normalizedDeviceId,
      firmwareVersion: firmwareVersion,
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
          'firmware.desiredVersion': firmwareVersion,
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

    console.log('updateOne result:', updateResult);
    console.log('Matched count:', updateResult.matchedCount);
    console.log('Modified count:', updateResult.modifiedCount);

    if (updateResult.matchedCount === 0) {
      throw new AppError('Device not found', 404);
    }

    const updatedDevice = await devicesCollection.findOne({
      deviceId: normalizedDeviceId,
    });

    if (!updatedDevice) {
      throw new AppError('Device update failed', 500);
    }

    console.log('Device found and updated successfully');

    const deviceData = {
      id: updatedDevice._id.toString(),
      ...updatedDevice,
      _id: undefined,
    };

    return deviceData;
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw new AppError(`Failed to assign firmware to device: ${error.message}`, 500);
  }
};

export const reportDeviceFirmware = async (deviceId, reportedFirmwareVersion, otaStatus) => {
  try {
    const normalizedDeviceId = String(deviceId).trim();
    const db = await getDb();
    const devicesCollection = db.collection('devices');

    let device = await devicesCollection.findOne({ deviceId: normalizedDeviceId });

    if (!device) {
      device = await devicesCollection.findOne({
        deviceId: { $regex: `^\\s*${normalizedDeviceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, $options: 'i' }
      });
    }

    if (!device) {
      throw new AppError('Device not found', 404);
    }

    if (device.status === 'inactive' || device.status === 'disabled') {
      throw new AppError('Device is not active', 403);
    }

    // ========================================================================
    // VALIDATE otaStatus (REQUIRED - NO INFERENCE)
    // ========================================================================
    const validOtaStatuses = ['downloading', 'updating', 'success', 'failed'];
    if (!otaStatus || !validOtaStatuses.includes(otaStatus)) {
      throw new AppError(`otaStatus is required and must be one of: ${validOtaStatuses.join(', ')}`, 400);
    }

    // ========================================================================
    // OTA STATE TRANSITION GUARD (STRICT - EXECUTES BEFORE ANY UPDATES)
    // ========================================================================
    const currentFirmwareStatus = device.firmware?.status || 'idle';

    // Define allowed transitions: from → to
    const allowedTransitions = {
      'assigned': ['downloading'],
      'downloading': ['updating'],
      'updating': ['success', 'failed'],
    };

    // Reject if current status is terminal or invalid for OTA reports
    const invalidStatusesForReport = ['idle', 'pending', 'success', 'failed'];
    if (invalidStatusesForReport.includes(currentFirmwareStatus)) {
      throw new AppError(
        `Invalid OTA state transition: cannot report OTA progress when firmware.status is "${currentFirmwareStatus}". ` +
        `Device must be in "assigned", "downloading", or "updating" state to report OTA progress.`,
        400
      );
    }

    // Validate transition is allowed
    const allowedNextStatuses = allowedTransitions[currentFirmwareStatus];
    if (!allowedNextStatuses) {
      throw new AppError(
        `Invalid OTA state transition: current firmware.status "${currentFirmwareStatus}" does not allow OTA reports. ` +
        `Only transitions from "assigned", "downloading", or "updating" are allowed.`,
        400
      );
    }

    if (!allowedNextStatuses.includes(otaStatus)) {
      throw new AppError(
        `Invalid OTA state transition: cannot transition from "${currentFirmwareStatus}" to "${otaStatus}". ` +
        `Allowed transitions from "${currentFirmwareStatus}": ${allowedNextStatuses.join(', ')}.`,
        400
      );
    }

    const updateFields = {
      reportedFirmwareVersion: reportedFirmwareVersion,
      lastSeenAt: new Date(),
    };

    // ========================================================================
    // MAP otaStatus TO ota_events.action (DIRECT MAPPING - NO INFERENCE)
    // ========================================================================
    const otaStatusToActionMap = {
      'downloading': 'download',
      'updating': 'update',
      'success': 'success',
      'failed': 'fail',
    };
    const eventAction = otaStatusToActionMap[otaStatus];

    // ========================================================================
    // UPDATE DEVICE STATE BASED ON otaStatus
    // ========================================================================
    if (otaStatus === 'failed') {
      updateFields['firmware.status'] = 'failed';
    } else if (otaStatus === 'success') {
      // STATE CONSISTENCY GUARD: Only update currentVersion on success
      if (!device.firmware?.desiredVersion) {
        throw new AppError('Cannot report success without an assigned desiredVersion', 400);
      }
      if (reportedFirmwareVersion !== device.firmware.desiredVersion) {
        throw new AppError(`Reported firmware version ${reportedFirmwareVersion} does not match desired version ${device.firmware.desiredVersion}`, 400);
      }
      updateFields['firmware.currentVersion'] = reportedFirmwareVersion;
      updateFields['firmware.desiredVersion'] = null;
      updateFields['firmware.status'] = 'success';
    } else if (otaStatus === 'downloading' || otaStatus === 'updating') {
      if (!device.firmware?.desiredVersion) {
        throw new AppError(`Cannot report ${otaStatus} without an assigned desiredVersion`, 400);
      }
      updateFields['firmware.status'] = otaStatus;
    }

    // ========================================================================
    // LOG OTA EVENT (ALWAYS LOG WHEN otaStatus PROVIDED)
    // ========================================================================
    if (!device.firmware?.desiredVersion) {
      throw new AppError('Cannot log OTA event without an assigned desiredVersion', 400);
    }
    await logOTAEvent({
      deviceId: normalizedDeviceId,
      firmwareVersion: device.firmware.desiredVersion,
      action: eventAction,
      source: 'device',
      metadata: {
        reportedFirmwareVersion,
        otaStatus,
      },
    });

    await devicesCollection.updateOne(
      { deviceId: normalizedDeviceId },
      { $set: updateFields }
    );

    const updatedDevice = await devicesCollection.findOne({
      deviceId: normalizedDeviceId,
    });

    if (!updatedDevice) {
      throw new AppError('Device update failed', 500);
    }

    const deviceData = {
      id: updatedDevice._id.toString(),
      ...updatedDevice,
      _id: undefined,
    };

    return deviceData;
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw new AppError(`Failed to report device firmware: ${error.message}`, 500);
  }
};

export const retryOTAForDevice = async (deviceId) => {
  try {
    const normalizedDeviceId = String(deviceId).trim();
    const db = await getDb();
    const devicesCollection = db.collection('devices');

    let device = await devicesCollection.findOne({ deviceId: normalizedDeviceId });

    if (!device) {
      device = await devicesCollection.findOne({
        deviceId: { $regex: `^\\s*${normalizedDeviceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, $options: 'i' }
      });
    }

    if (!device) {
      throw new AppError('Device not found', 404);
    }

    if (device.status === 'inactive' || device.status === 'disabled') {
      throw new AppError('Device is not active', 403);
    }

    // Check firmware status using new schema
    const firmwareStatus = device.firmware?.status;
    if (firmwareStatus !== 'failed') {
      throw new AppError('OTA retry is only allowed when firmware.status is "failed"', 400);
    }

    if (!device.firmware?.desiredVersion) {
      throw new AppError('No target firmware version found for retry', 400);
    }

    const updateResult = await devicesCollection.updateOne(
      { deviceId: normalizedDeviceId },
      {
        $set: {
          'firmware.status': 'pending',
          'firmware.assignedAt': new Date(),
          updatedAt: new Date(),
        },
      }
    );

    if (updateResult.matchedCount === 0) {
      throw new AppError('Device not found', 404);
    }

    const updatedDevice = await devicesCollection.findOne({
      deviceId: normalizedDeviceId,
    });

    if (!updatedDevice) {
      throw new AppError('Device update failed', 500);
    }

    const deviceData = {
      id: updatedDevice._id.toString(),
      ...updatedDevice,
      _id: undefined,
    };

    return deviceData;
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw new AppError(`Failed to retry OTA for device: ${error.message}`, 500);
  }
};