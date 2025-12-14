import { queryLogs } from '../services/logsService.js';
import { validateQueryParams } from '../utils/validators.js';

export const getLogsHandler = async (req, res, next) => {
  try {
    const queryParams = validateQueryParams(req.query);
    if (req.query.deviceId) queryParams.deviceId = req.query.deviceId;
    if (req.query.level) queryParams.level = req.query.level;

    const logs = await queryLogs(queryParams);

    res.json({
      success: true,
      data: logs,
      count: logs.length,
    });
  } catch (error) {
    next(error);
  }
};

