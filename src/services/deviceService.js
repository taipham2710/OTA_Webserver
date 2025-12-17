import { getDb } from '../clients/mongodb.js';
import { getElasticsearchClient } from '../clients/elasticsearch.js';
import { getQueryApi } from '../clients/influxdb.js';
import { getAnomalyAnalysis } from './anomalyService.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';

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

    return devices.map(device => ({
      id: device._id.toString(),
      ...device,
      _id: undefined,
    }));
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

    const deviceData = {
      id: device._id.toString(),
      ...device,
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

    // Get anomaly score from FastAPI inference service
    try {
      const anomalyData = await getAnomalyAnalysis(deviceId);
      deviceData.anomalyScore = anomalyData.anomalyScore ?? null;
      deviceData.anomalyThreshold = anomalyData.threshold ?? null;
      deviceData.isAnomaly = anomalyData.isAnomaly ?? false;
    } catch (error) {
      // NOTE: Temporary fallback for MVP/demo stability.
      // Should be replaced with strict failure handling in production.
      deviceData.anomalyScore = null;
      deviceData.anomalyThreshold = null;
      deviceData.isAnomaly = false;
    }

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

    const updateResult = await devicesCollection.updateOne(
      { deviceId: normalizedDeviceId },
      {
        $set: {
          firmwareVersion: firmwareVersion,
          targetFirmwareVersion: firmwareVersion,
          otaStatus: 'pending',
          firmwareAssignedAt: new Date(),
          updatedAt: new Date(),
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

export const reportDeviceFirmware = async (deviceId, reportedFirmwareVersion, status) => {
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

    const updateFields = {
      reportedFirmwareVersion: reportedFirmwareVersion,
      lastSeenAt: new Date(),
    };

    if (status === 'failed') {
      updateFields.otaStatus = 'failed';
    } else if (device.targetFirmwareVersion && reportedFirmwareVersion === device.targetFirmwareVersion) {
      updateFields.firmwareVersion = reportedFirmwareVersion;
      updateFields.targetFirmwareVersion = null;
      updateFields.otaStatus = 'completed';
    }

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

    if (device.otaStatus !== 'failed') {
      throw new AppError('OTA retry is only allowed when otaStatus is "failed"', 400);
    }

    if (!device.targetFirmwareVersion) {
      throw new AppError('No target firmware version found for retry', 400);
    }

    const updateResult = await devicesCollection.updateOne(
      { deviceId: normalizedDeviceId },
      {
        $set: {
          otaStatus: 'pending',
          firmwareAssignedAt: new Date(),
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