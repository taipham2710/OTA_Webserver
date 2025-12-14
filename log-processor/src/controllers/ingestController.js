import { validateIngestPayload } from '../utils/validation.js';
import { processLogEntry } from '../services/ingestService.js';

export const ingestHandler = async (req, res, next) => {
  try {
    const normalized = validateIngestPayload(req.body);
    await processLogEntry(normalized);

    res.status(202).json({
      success: true,
      message: 'Log accepted',
    });
  } catch (err) {
    next(err);
  }
};


