import express from 'express';
import { config } from '../config/index.js';

const router = express.Router();

router.get('/config', (req, res) => {
  res.json({
    grafanaUrl: config.grafana?.url || null,
  });
});

export default router;

