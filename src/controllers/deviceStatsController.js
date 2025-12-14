import { getDeviceStatistics } from '../services/deviceStatsService.js';

export const getDeviceStatisticsHandler = async (req, res, next) => {
  try {
    const stats = await getDeviceStatistics();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

