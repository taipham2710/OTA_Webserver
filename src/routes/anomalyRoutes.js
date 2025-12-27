import express from 'express';
import {
  getAnomalyHandler,
  getAnomalyAnalysisHandler,
  postAnomalyInferHandler,
  getAnomaliesHistoryHandler
} from '../controllers/anomalyController.js';

const router = express.Router();

// Read-only: Get current anomaly state from devices collection
router.get('/:device_id', getAnomalyHandler);

// Manual analysis: ML inference without updating production state
router.get('/:device_id/analyze', getAnomalyAnalysisHandler);

// Production inference: ML inference with production state update (ONLY writer of devices.anomaly and anomaly_events)
router.post('/:device_id/infer', postAnomalyInferHandler);

// Read-only: Get anomaly history from anomaly_events collection
router.get('/:device_id/history', getAnomaliesHistoryHandler);

export default router;
