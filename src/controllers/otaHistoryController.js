import { getOTAHistory } from '../services/otaService.js';
import { validateDeviceId } from '../utils/validators.js';

export const getOTAHistoryHandler = async (req, res, next) => {
  try {
    const deviceId = validateDeviceId(req.params.device_id);
    const history = await getOTAHistory(deviceId);

    res.json({
      success: true,
      data: history,
      count: history.length,
    });
  } catch (error) {
    next(error);
  }
};

