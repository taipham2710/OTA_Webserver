import express from 'express';
import { getModelInfoHandler } from '../controllers/modelController.js';

const router = express.Router();

// NOTE: Metadata-only endpoint. Does not block server startup if inference is unavailable.
router.get('/info', getModelInfoHandler);

export default router;

