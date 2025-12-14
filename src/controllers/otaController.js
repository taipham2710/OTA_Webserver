import { deployOTA } from '../services/otaService.js';
import { AppError } from '../utils/errors.js';

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

