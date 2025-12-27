import express from 'express';
import { activateModelHandler } from '../controllers/internalModelController.js';

const router = express.Router();

router.post('/activate', activateModelHandler);

export default router;

