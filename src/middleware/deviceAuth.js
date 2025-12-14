import { getDb } from '../clients/mongodb.js';
import { AppError } from '../utils/errors.js';

export const authenticateDevice = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const token = req.headers['x-device-token'];

    if (!deviceId || typeof deviceId !== 'string') {
      throw new AppError('Device ID is required', 400);
    }

    if (!token || typeof token !== 'string') {
      throw new AppError('X-Device-Token header is required', 401);
    }

    const db = await getDb();
    const devicesCollection = db.collection('devices');

    const normalizedDeviceId = String(deviceId).trim();
    let device = await devicesCollection.findOne({ deviceId: normalizedDeviceId });

    if (!device) {
      device = await devicesCollection.findOne({
        deviceId: { $regex: `^\\s*${normalizedDeviceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, $options: 'i' }
      });
    }

    if (!device) {
      throw new AppError('Device not found', 401);
    }

    if (!device.deviceToken || device.deviceToken !== token) {
      throw new AppError('Invalid device token', 401);
    }

    req.authenticatedDevice = device;
    next();
  } catch (error) {
    if (error.statusCode) {
      next(error);
    } else {
      next(new AppError('Authentication failed', 401));
    }
  }
};
