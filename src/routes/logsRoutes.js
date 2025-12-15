import express from 'express';
import { getLogsHandler, ingestLogsHandler } from '../controllers/logsController.js';

const router = express.Router();

router.post('/', ingestLogsHandler);
router.get('/', getLogsHandler);

export default router;

