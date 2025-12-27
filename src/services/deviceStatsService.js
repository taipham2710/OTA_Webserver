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
    
    // Count by anomaly state stored in devices.anomaly (single source of truth)
    devices.forEach(device => {
      const risk = device?.anomaly?.risk_level || null;
      if (risk === 'high') {
        anomalyCount++;
      } else if (risk === 'warning') {
        warningCount++;
      } else {
        normalCount++;
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
