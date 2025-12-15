import express from 'express';
import { getMetricsHandler, ingestMetricsHandler } from '../controllers/metricsController.js';

const router = express.Router();

router.post('/', ingestMetricsHandler);
router.get('/', getMetricsHandler);

export default router;

