import { activateModelVersion } from '../services/modelActivationService.js';
import { AppError } from '../utils/errors.js';
import { getIO } from '../realtime/socket.js';
import { getDb } from '../clients/mongodb.js';

export const activateModelHandler = async (req, res, next) => {
  try {
    const modelVersion = req.body?.model_version;
    const reasonRaw = req.body?.reason;
    const reason =
      typeof reasonRaw === 'string' && reasonRaw.trim().length > 0 ? reasonRaw.trim() : null;

    const result = await activateModelVersion({ modelVersion });
    const payload = {
      model_version: result.modelVersion,
      updated_at: new Date().toISOString(),
      reason,
      changed: result.changed === true,
    };

    if (payload.changed === true) {
      const io = getIO();
      if (io) {
        io.emit('model_updated', payload);
      }

      // Audit trail (best-effort): do not block activation on Mongo failures.
      try {
        const db = await getDb();
        await db.collection('model_events').insertOne({
          model_version: payload.model_version,
          activated_at: new Date(payload.updated_at),
          reason: payload.reason,
          source: 'manual',
        });
      } catch (error) {
        console.warn(`Failed to write model_events audit record: ${error.message}`);
      }
    }

    res.status(200).json({
      success: true,
      data: payload,
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode || 400).json({
        success: false,
        error: error.message,
      });
      return;
    }
    next(error);
  }
};
