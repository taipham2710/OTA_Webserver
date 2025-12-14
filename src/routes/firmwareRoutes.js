import express from 'express';
import multer from 'multer';
import { uploadFirmwareHandler, getFirmwareListHandler, getFirmwareByVersionHandler, assignFirmwareHandler } from '../controllers/firmwareController.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', getFirmwareListHandler);
router.get('/:version', getFirmwareByVersionHandler);
router.post('/upload', upload.single('firmware'), uploadFirmwareHandler);
router.post('/assign', assignFirmwareHandler);

export default router;

