import express from 'express';
import { getLogsHandler } from '../controllers/logsController.js';

const router = express.Router();

router.get('/', getLogsHandler);

export default router;

