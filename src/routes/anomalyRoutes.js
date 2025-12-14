import express from 'express';
import { getAnomalyHandler } from '../controllers/anomalyController.js';

const router = express.Router();

router.get('/:device_id', getAnomalyHandler);

export default router;

