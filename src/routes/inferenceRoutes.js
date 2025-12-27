import express from 'express';
import {
  inferenceHealthHandler,
  inferenceMetadataHandler,
  inferencePredictHandler,
  inferenceReadyHandler,
} from '../controllers/inferenceController.js';

const router = express.Router();

router.get('/health', inferenceHealthHandler);
router.get('/ready', inferenceReadyHandler);
router.get('/metadata', inferenceMetadataHandler);
router.post('/predict', inferencePredictHandler);

export default router;

