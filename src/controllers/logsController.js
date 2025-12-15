import { queryLogs, ingestLog } from '../services/logsService.js';
import { validateQueryParams } from '../utils/validators.js';
import { getIO } from '../realtime/socket.js';

export const getLogsHandler = async (req, res, next) => {
  try {
    const queryParams = validateQueryParams(req.query);
    if (req.query.deviceId) queryParams.deviceId = req.query.deviceId;
    if (req.query.level) queryParams.level = req.query.level;
    if (req.query.limit) queryParams.limit = parseInt(req.query.limit, 10) || 100;

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

export const ingestLogsHandler = async (req, res, next) => {
  try {
    const logData = req.body;

    const ingestedLog = await ingestLog(logData);

    const io = getIO();
    if (io) {
      // TODO: Standardize Socket.IO event naming in future refactor
      // Currently using 'log:new' for global and 'logs' for device-specific events
      io.emit('log:new', ingestedLog);
      if (ingestedLog.deviceId) {
        io.to(`device:${ingestedLog.deviceId}`).emit('logs', ingestedLog);
      }
    }

    res.status(201).json({
      success: true,
      data: ingestedLog,
      message: 'Log ingested successfully',
    });
  } catch (error) {
    next(error);
  }
};

