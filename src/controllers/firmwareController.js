import { uploadFirmware, getFirmwareList, getFirmwareByVersion, assignFirmware } from '../services/firmwareService.js';
import { AppError } from '../utils/errors.js';

export const uploadFirmwareHandler = async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const metadata = {
      uploadedAt: new Date().toISOString(),
      uploadedBy: req.body.uploadedBy || 'system',
    };

    const result = await uploadFirmware(req.file, metadata);

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getFirmwareListHandler = async (req, res, next) => {
  console.log('--- GET /api/firmware request received ---');
  try {
    const { limit, skip } = req.query;
    const queryParams = {
      limit: limit ? parseInt(limit, 10) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
    };

    const firmwareList = await getFirmwareList(queryParams);

    res.json({
      success: true,
      data: firmwareList,
      count: firmwareList.length,
    });
  } catch (error) {
    next(error);
  }
};

export const getFirmwareByVersionHandler = async (req, res, next) => {
  try {
    const version = req.params.version;
    if (!version || typeof version !== 'string') {
      throw new AppError('Firmware version is required', 400);
    }

    const firmware = await getFirmwareByVersion(version);

    res.json({
      success: true,
      data: firmware,
    });
  } catch (error) {
    next(error);
  }
};

export const assignFirmwareHandler = async (req, res, next) => {
  try {
    const { deviceId, firmwareVersion } = req.body;

    if (!deviceId || !firmwareVersion) {
      throw new AppError('deviceId and firmwareVersion are required', 400);
    }

    const assignment = await assignFirmware({ deviceId, firmwareVersion });

    res.status(201).json({
      success: true,
      data: assignment,
    });
  } catch (error) {
    next(error);
  }
};

