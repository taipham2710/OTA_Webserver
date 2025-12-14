import { getDb } from '../clients/mongodb.js';
import { AppError } from '../utils/errors.js';

export const getDeviceStatistics = async () => {
  try {
    const db = await getDb();
    const collection = db.collection('devices');
    
    // Get all devices with status
    const devices = await collection.find({}).toArray();
    
    const totalDevices = devices.length;
    let normalCount = 0;
    let anomalyCount = 0;
    let warningCount = 0;
    
    // Count by status (if devices have isAnomaly field stored)
    devices.forEach(device => {
      if (device.isAnomaly === true) {
        anomalyCount++;
      } else if (device.isAnomaly === false) {
        normalCount++;
      } else if (device.status === 'warning' || device.status === 'degraded') {
        warningCount++;
      } else {
        normalCount++; // Default to normal
      }
    });
    
    return {
      total: totalDevices,
      normal: normalCount,
      anomaly: anomalyCount,
      warning: warningCount,
    };
  } catch (error) {
    throw new AppError(`Failed to get device statistics: ${error.message}`, 500);
  }
};

