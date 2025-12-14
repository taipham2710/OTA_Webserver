import express from 'express';
import { livenessHandler, readinessHandler, healthCheckHandler } from '../controllers/healthController.js';

const router = express.Router();

// Liveness probe - always returns 200 OK
router.get('/live', livenessHandler);

// Readiness probe - checks if server is listening
router.get('/ready', readinessHandler);

// Health check - checks dependencies but never crashes
router.get('/', healthCheckHandler);

export default router;

