import { validateDeviceId } from '../utils/validators.js';
import { getAnomalyMonitorForDevice } from '../services/anomalyMonitorService.js';

export const getAnomalyMonitorHandler = async (req, res, next) => {
  try {
    const deviceId = validateDeviceId(req.params.deviceId);
    const monitor = await getAnomalyMonitorForDevice(deviceId);

    res.json(monitor);
  } catch (error) {
    next(error);
  }
};

