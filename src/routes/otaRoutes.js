import express from 'express';
import { deployOTAHandler, assignOTAHandler } from '../controllers/otaController.js';
import { getOTAHistoryHandler } from '../controllers/otaHistoryController.js';

const router = express.Router();

router.post('/assign', assignOTAHandler);
router.post('/deploy', deployOTAHandler);
router.get('/history/:device_id', getOTAHistoryHandler);

export default router;