import { queryMetrics } from '../services/metricsService.js';
import { validateQueryParams } from '../utils/validators.js';

export const getMetricsHandler = async (req, res, next) => {
  try {
    const queryParams = validateQueryParams(req.query);
    if (req.query.deviceId) queryParams.deviceId = req.query.deviceId;
    if (req.query.measurement) queryParams.measurement = req.query.measurement;

    const metrics = await queryMetrics(queryParams);

    res.json({
      success: true,
      data: metrics,
      count: metrics.length,
    });
  } catch (error) {
    next(error);
  }
};

