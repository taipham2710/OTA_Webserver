import express from 'express';
import { getModelInfoHandler, getCurrentModelHandler, getModelArtifactsHandler } from '../controllers/modelController.js';

const router = express.Router();

// NOTE: Metadata-only endpoint. Does not block server startup if inference is unavailable.
router.get('/info', getModelInfoHandler);

// NOTE: Returns current model data from MinIO storage (metadata, features, drift).
// Reads from models/{version}/ directory in MinIO bucket.
// Query param: ?version=v1 (default: v1)
router.get('/current', getCurrentModelHandler);

// Read-only: artifact existence checklist for operational UI.
router.get('/artifacts', getModelArtifactsHandler);

export default router;
