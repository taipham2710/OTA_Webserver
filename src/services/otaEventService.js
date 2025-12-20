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

