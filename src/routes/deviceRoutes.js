import express from 'express';
import { getDevicesHandler, getDeviceByIdHandler, assignFirmwareToDeviceHandler, reportDeviceFirmwareHandler, retryOTAForDeviceHandler, getOTAEventsHandler } from '../controllers/deviceController.js';
import { getDeviceStatisticsHandler } from '../controllers/deviceStatsController.js';
import { getAnomaliesHistoryHandler } from '../controllers/anomalyController.js';
import { getAnomalyMonitorHandler } from '../controllers/anomalyMonitorController.js';
import { getAnomalyHistorySummaryHandler } from '../controllers/anomalySummaryController.js';
import { authenticateDevice } from '../middleware/deviceAuth.js';
import { rateLimitDevice } from '../middleware/rateLimit.js';

const router = express.Router();

router.get('/stats', getDeviceStatisticsHandler);
router.get('/', getDevicesHandler);
router.get('/:deviceId/anomalies', getAnomaliesHistoryHandler);
router.get('/:deviceId/anomaly/monitor', getAnomalyMonitorHandler);
router.get('/:deviceId/anomaly/summary', getAnomalyHistorySummaryHandler);
router.get('/:deviceId/ota-events', getOTAEventsHandler);
router.patch('/:deviceId/assign-firmware', assignFirmwareToDeviceHandler);
router.post('/:deviceId/retry-ota', retryOTAForDeviceHandler);
router.post('/:deviceId/report', rateLimitDevice(60, 60000), authenticateDevice, reportDeviceFirmwareHandler);
router.get('/:id', getDeviceByIdHandler);

export default router;
