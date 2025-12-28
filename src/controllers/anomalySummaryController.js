import { validateDeviceId } from '../utils/validators.js';
import { getAnomalyHistorySummaryForDevice } from '../services/anomalySummaryService.js';

export const getAnomalyHistorySummaryHandler = async (req, res, next) => {
  try {
    const deviceId = validateDeviceId(req.params.deviceId);
    const summary = await getAnomalyHistorySummaryForDevice(deviceId);
    res.json(summary);
  } catch (error) {
    next(error);
  }
};

