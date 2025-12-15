import { queryMetrics, ingestMetrics } from '../services/metricsService.js';
import { validateQueryParams } from '../utils/validators.js';
import { getIO } from '../realtime/socket.js';

export const getMetricsHandler = async (req, res, next) => {
  try {
    const queryParams = validateQueryParams(req.query);
    if (req.query.deviceId) queryParams.deviceId = req.query.deviceId;
    if (req.query.start) queryParams.start = new Date(req.query.start);
    if (req.query.end) queryParams.end = new Date(req.query.end);
    if (req.query.limit) queryParams.limit = parseInt(req.query.limit, 10) || 100;

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

export const ingestMetricsHandler = async (req, res, next) => {
  try {
    const metricsData = req.body;

    const ingestedMetric = await ingestMetrics(metricsData);

    const io = getIO();
    if (io) {
      io.emit('metric:new', ingestedMetric);
      if (ingestedMetric.deviceId) {
        io.to(`device:${ingestedMetric.deviceId}`).emit('metrics', ingestedMetric);
      }
    }

    res.status(201).json({
      success: true,
      data: ingestedMetric,
      message: 'Metrics ingested successfully',
    });
  } catch (error) {
    next(error);
  }
};

