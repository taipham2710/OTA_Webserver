import express from 'express';
import { getModelInfoHandler } from '../controllers/modelController.js';

const router = express.Router();

router.get('/', getModelInfoHandler);

export default router;

