import { deployOTA, assignOTA } from '../services/otaService.js';
import { AppError } from '../utils/errors.js';

export const assignOTAHandler = async (req, res, next) => {
  try {
    const { deviceIds, firmwareVersion } = req.body;

    if (!deviceIds || !Array.isArray(deviceIds) || deviceIds.length === 0) {
      throw new AppError('deviceIds array is required and must not be empty', 400);
    }

    if (!firmwareVersion || typeof firmwareVersion !== 'string') {
      throw new AppError('firmwareVersion is required', 400);
    }

    const result = await assignOTA({ deviceIds, firmwareVersion });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const deployOTAHandler = async (req, res, next) => {
  try {
    const { deviceId, firmwareVersion, firmwareUrl } = req.body;

    if (!deviceId || !firmwareVersion || !firmwareUrl) {
      throw new AppError('deviceId, firmwareVersion, and firmwareUrl are required', 400);
    }

    const deployment = await deployOTA({
      deviceId,
      firmwareVersion,
      firmwareUrl,
      ...req.body,
    });

    res.status(201).json({
      success: true,
      data: deployment,
    });
  } catch (error) {
    next(error);
  }
};