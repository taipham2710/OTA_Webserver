import path from 'path';
import { getMinioClient, ensureBucketExists } from '../clients/minio.js';
import { getDb } from '../clients/mongodb.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';

export const uploadFirmware = async (file, metadata = {}) => {
  try {
    await ensureBucketExists();
    const client = getMinioClient();
    
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `${Date.now()}-${safeName}`;
    const objectName = `firmware/${fileName}`;

    await client.putObject(
      config.minio.bucket,
      objectName,
      file.buffer,
      file.size,
      {
        'Content-Type': file.mimetype,
        ...metadata,
      }
    );

    const url = `/${config.minio.bucket}/${objectName}`;
    const version = metadata.version || fileName.split('-')[0] || Date.now().toString();

    // Save firmware metadata to MongoDB
    const db = await getDb();
    const collection = db.collection('firmwares');
    
    const firmwareDoc = {
      version,
      fileName,
      size: file.size,
      url,
      createdAt: new Date(),
      status: 'active',
      metadata: {
        ...metadata,
        originalName: file.originalname,
        mimeType: file.mimetype,
      },
    };

    await collection.insertOne(firmwareDoc);

    return {
      fileName,
      objectName,
      size: file.size,
      url,
      version,
    };
  } catch (error) {
    throw new AppError(`Failed to upload firmware: ${error.message}`, 500);
  }
};

export const getFirmwareList = async (queryParams = {}) => {
  try {
    const db = await getDb();
    const collection = db.collection('firmwares');
    
    const { limit = 100, skip = 0 } = queryParams;
    
    console.log('Query parameters:', { limit, skip });
    console.log('Database name:', db.databaseName);
    console.log('Collection name: firmwares');
    
    const firmwareList = await collection
      .find({})
      .sort({ version: -1, createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .toArray();

    console.log('Data from MongoDB:', firmwareList);
    console.log('Number of documents found:', firmwareList.length);

    const mappedFirmwareList = firmwareList.map(fw => ({
      id: fw._id.toString(),
      version: fw.version,
      fileName: fw.fileName,
      size: fw.size,
      url: fw.url,
      createdAt: fw.createdAt,
      status: fw.status || 'active',
      _id: undefined,
    }));

    console.log('Mapped firmware list (after transformation):', mappedFirmwareList);
    console.log('Mapped list count:', mappedFirmwareList.length);

    return mappedFirmwareList;
  } catch (error) {
    throw new AppError(`Failed to get firmware list: ${error.message}`, 500);
  }
};

export const getFirmwareByVersion = async (version) => {
  try {
    const db = await getDb();
    const collection = db.collection('firmwares');
    
    const firmware = await collection.findOne({ version });
    
    if (!firmware) {
      throw new AppError('Firmware version not found', 404);
    }

    return {
      id: firmware._id.toString(),
      version: firmware.version,
      fileName: firmware.fileName,
      size: firmware.size,
      url: firmware.url,
      createdAt: firmware.createdAt,
      status: firmware.status || 'active',
      metadata: firmware.metadata || {},
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw new AppError(`Failed to get firmware: ${error.message}`, 500);
  }
};

export const assignFirmware = async (assignmentData) => {
  try {
    const { deviceId, firmwareVersion } = assignmentData;

    if (!deviceId || !firmwareVersion) {
      throw new AppError('deviceId and firmwareVersion are required', 400);
    }

    const db = await getDb();
    const firmwareCollection = db.collection('firmwares');
    const devicesCollection = db.collection('devices');

    // Verify firmware exists
    const firmware = await firmwareCollection.findOne({ version: firmwareVersion });
    if (!firmware) {
      throw new AppError('Firmware version not found', 404);
    }

    // Verify device exists
    const device = await devicesCollection.findOne({ deviceId });
    if (!device) {
      throw new AppError('Device not found', 404);
    }

    // Create assignment record
    const assignment = {
      deviceId,
      firmwareVersion,
      firmwareUrl: firmware.url,
      assignedAt: new Date(),
      status: 'pending',
    };

    const assignmentsCollection = db.collection('firmware_assignments');
    const result = await assignmentsCollection.insertOne(assignment);

    // Update device's assigned firmware
    await devicesCollection.updateOne(
      { deviceId },
      { $set: { assignedFirmware: firmwareVersion, firmwareUrl: firmware.url } }
    );

    return {
      id: result.insertedId.toString(),
      ...assignment,
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw new AppError(`Failed to assign firmware: ${error.message}`, 500);
  }
};

