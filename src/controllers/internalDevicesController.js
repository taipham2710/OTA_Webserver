import { AppError } from '../utils/errors.js';
import { provisionDevice } from '../services/deviceProvisionService.js';

export const provisionDeviceHandler = async (req, res, next) => {
  try {
    // Not for production device self-registration.
    // This endpoint is for experimental provisioning only and MUST NOT be enabled in production.
    const enabled = String(process.env.ENABLE_INTERNAL_PROVISIONING || '').toLowerCase() === 'true';
    if (!enabled) {
      // Must be disabled by default and return 404 when disabled.
      throw new AppError('Not Found', 404);
    }

    const configuredKey = process.env.ADMIN_PROVISION_KEY;
    const providedKey = req.headers['x-admin-key'];
    if (!configuredKey || typeof configuredKey !== 'string') {
      throw new AppError('Provisioning is not configured', 500);
    }
    if (!providedKey || typeof providedKey !== 'string' || providedKey !== configuredKey) {
      throw new AppError('Unauthorized', 401);
    }

    const { deviceId } = req.body || {};
    const result = await provisionDevice({ deviceId });

    res.json(result);
  } catch (error) {
    next(error);
  }
};
