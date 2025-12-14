import express from 'express';
import { ingestHandler } from '../controllers/ingestController.js';

const router = express.Router();

router.post('/ingest', ingestHandler);

export default router;


