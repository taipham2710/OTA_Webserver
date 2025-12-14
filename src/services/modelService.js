import { getDb } from '../clients/mongodb.js';
import { AppError } from '../utils/errors.js';

export const getModelInfo = async () => {
  try {
    const db = await getDb();
    const collection = db.collection('model_info');
    
    const modelInfo = await collection.findOne({}, { sort: { train_date: -1 } });
    
    if (!modelInfo) {
      return {
        version: null,
        train_date: null,
        train_window_size: null,
        f1: null,
        pr_auc: null,
        roc_auc: null,
        holdout_f1: null,
        drift_status: 'unknown',
        drift_features: [],
        features: [],
      };
    }

    const driftFeatures = modelInfo.drift_features || [];
    const driftStatus = driftFeatures.length > 0 ? 'detected' : 'none';
    const driftDetected = driftFeatures.length > 0 || modelInfo.drift_status === 'detected';
    
    const allFeatures = (modelInfo.features || []).map(f => ({
      name: f.name,
      importance: f.importance || 0,
    }));
    
    // Sort by importance and get top features
    const topFeatures = [...allFeatures]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 10);

    return {
      model_version: modelInfo.version || null,
      train_date: modelInfo.train_date || null,
      train_window_size: modelInfo.train_window_size || modelInfo.window_size || null,
      f1: modelInfo.f1 || null,
      pr_auc: modelInfo.pr_auc || null,
      roc_auc: modelInfo.roc_auc || null,
      holdout_f1: modelInfo.holdout_f1 || null,
      drift_detected: driftDetected,
      drift_status: modelInfo.drift_status || driftStatus,
      drift_features: driftFeatures,
      top_features: topFeatures,
      features: allFeatures,
    };
  } catch (error) {
    throw new AppError(`Failed to get model info: ${error.message}`, 500);
  }
};

