import crypto from 'crypto';
import { getDb } from '../clients/mongodb.js';
import { AppError } from '../utils/errors.js';

const normalizeDeviceId = (deviceId) => {
  if (typeof deviceId !== 'string') return null;
  const normalized = deviceId.trim();
  return normalized.length > 0 ? normalized : null;
};

export const provisionDevice = async ({ deviceId }) => {
  // Not for production device self-registration.
  // This endpoint is for experimental provisioning only and MUST NOT be enabled in production.
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  if (!normalizedDeviceId) {
    throw new AppError('deviceId is required', 400);
  }

  const db = await getDb();
  const devicesCollection = db.collection('devices');

  const existing = await devicesCollection.findOne({ deviceId: normalizedDeviceId });
  if (existing) {
    return {
      deviceId: normalizedDeviceId,
      deviceToken: existing.deviceToken || null,
      created: false,
    };
  }

  const deviceToken = crypto.randomBytes(32).toString('hex');
  const doc = {
    deviceId: normalizedDeviceId,
    deviceToken,
    createdAt: new Date(),
    lastSeenAt: null,
  };

  await devicesCollection.insertOne(doc);

  return {
    deviceId: normalizedDeviceId,
    deviceToken,
    created: true,
  };
};
