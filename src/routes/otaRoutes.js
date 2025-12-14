import express from 'express';
import { deployOTAHandler } from '../controllers/otaController.js';
import { getOTAHistoryHandler } from '../controllers/otaHistoryController.js';

const router = express.Router();

router.post('/deploy', deployOTAHandler);
router.get('/history/:device_id', getOTAHistoryHandler);

export default router;

