import express from 'express';
import { getMetricsHandler } from '../controllers/metricsController.js';

const router = express.Router();

router.get('/', getMetricsHandler);

export default router;

