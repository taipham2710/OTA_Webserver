import express from 'express';
import { provisionDeviceHandler } from '../controllers/internalDevicesController.js';

const router = express.Router();

router.post('/provision', provisionDeviceHandler);

export default router;

