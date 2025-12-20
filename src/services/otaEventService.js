// ============================================================================
// OTA EVENTS LOGGING SERVICE
// ============================================================================
// Logs OTA events to ota_events collection (append-only history)
//
// Architecture:
// - Append-only (no updates, no deletes)
// - Single source of truth for OTA timeline
// - device.firmware{} is the operational state
// ============================================================================

import { getDb } from '../clients/mongodb.js';
import { AppError } from '../utils/errors.js';

/**
 * Log an OTA event to ota_events collection
 * @param {Object} eventData - Event data
 * @param {string} eventData.deviceId - Device ID
 * @param {string} eventData.firmwareVersion - Firmware version
 * @param {string} eventData.action - Action: "assign" | "download" | "update" | "success" | "fail" | "rollback"
 * @param {string} eventData.source - Source: "admin" | "device" | "system"
 * @param {string} [eventData.reason] - Optional reason
 * @param {Object} [eventData.metadata] - Optional metadata
 */
export const logOTAEvent = async (eventData) => {
  try {
    const { deviceId, firmwareVersion, action, source, reason, metadata } = eventData;

    if (!deviceId || !firmwareVersion || !action || !source) {
      throw new Error('deviceId, firmwareVersion, action, and source are required');
    }

    const validActions = ['assign', 'download', 'update', 'success', 'fail', 'rollback'];
    if (!validActions.includes(action)) {
      throw new Error(`Invalid action: ${action}. Must be one of: ${validActions.join(', ')}`);
    }

    const validSources = ['admin', 'device', 'system'];
    if (!validSources.includes(source)) {
      throw new Error(`Invalid source: ${source}. Must be one of: ${validSources.join(', ')}`);
    }

    const db = await getDb();
    const otaEventsCollection = db.collection('ota_events');

    const event = {
      deviceId: String(deviceId).trim(),
      firmwareVersion: String(firmwareVersion),
      action,
      source,
      reason: reason || null,
      metadata: metadata || null,
      createdAt: new Date(),
    };

    await otaEventsCollection.insertOne(event);
  } catch (error) {
    // Log error but don't throw - event logging should not fail the main operation
    console.error(`Failed to log OTA event: ${error.message}`, eventData);
  }
};

/**
 * Get OTA events for a device (read-only history)
 * @param {string} deviceId - Device ID
 * @returns {Array} Array of OTA event objects
 */
export const getOTAEvents = async (deviceId) => {
  try {
    const normalizedDeviceId = String(deviceId).trim();
    const db = await getDb();
    
    // Check device exists (return 404 if not found)
    const devicesCollection = db.collection('devices');
    const device = await devicesCollection.findOne({ deviceId: normalizedDeviceId });
    
    if (!device) {
      throw new AppError('Device not found', 404);
    }

    // Query ota_events collection (read-only)
    const otaEventsCollection = db.collection('ota_events');
    const events = await otaEventsCollection
      .find({ deviceId: normalizedDeviceId })
      .sort({ createdAt: 1 }) // ASC: oldest → newest
      .toArray();

    // Return only fields needed for timeline
    return events.map(event => ({
      action: event.action,
      source: event.source,
      firmwareVersion: event.firmwareVersion,
      reason: event.reason,
      metadata: event.metadata,
      createdAt: event.createdAt,
    }));
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw new AppError(`Failed to get OTA events: ${error.message}`, 500);
  }
};

