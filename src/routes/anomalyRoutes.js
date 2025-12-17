import express from 'express';
import { getAnomalyHandler, getAnomaliesHistoryHandler } from '../controllers/anomalyController.js';

const router = express.Router();

router.get('/:device_id', getAnomalyHandler);
router.get('/:device_id/history', getAnomaliesHistoryHandler);

export default router;

