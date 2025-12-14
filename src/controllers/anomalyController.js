import { getAnomalyAnalysis } from '../services/anomalyService.js';
import { validateDeviceId } from '../utils/validators.js';

export const getAnomalyHandler = async (req, res, next) => {
  try {
    const deviceId = validateDeviceId(req.params.device_id);
    const result = await getAnomalyAnalysis(deviceId);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

