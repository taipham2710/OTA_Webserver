import { getDb } from '../clients/mongodb.js';
import { AppError } from '../utils/errors.js';

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

