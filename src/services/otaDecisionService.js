// ============================================================================
// OTA DECISION ENGINE
// ============================================================================
// Rule-based decision engine that recommends OTA actions based on
// anomaly explanations.
//
// Architecture:
// - Pure rule-based (no ML)
// - Action types: allow, block, delay, retry
// - Confidence scoring (0.0 - 1.0)
// - Reason-based recommendations
// ============================================================================

/**
 * Build OTA recommendation from anomaly explanations
 * @param {Array} explanations - Array of explanation objects from buildAnomalyExplanations()
 * @returns {Object} OTA recommendation with action, confidence, and reasons
 */
export const buildOTARecommendation = (explanations = []) => {
  if (!explanations.length) {
    return {
      action: 'allow',
      confidence: 0.9,
      reason: ['No significant anomalies detected'],
    };
  }

  const hasSecurity = explanations.some(
    (e) => e.category === 'security' && e.severity === 'high'
  );

  if (hasSecurity) {
    return {
      action: 'block',
      confidence: 0.95,
      reason: [
        'Security-related anomaly detected',
        'OTA blocked to prevent further risk',
      ],
    };
  }

  const hasNetworkOrOperational = explanations.some(
    (e) =>
      ['communication', 'operational'].includes(e.category) &&
      e.severity !== 'low'
  );

  if (hasNetworkOrOperational) {
    return {
      action: 'delay',
      confidence: 0.8,
      reason: [
        'Device is unstable',
        'OTA postponed until device state improves',
      ],
    };
  }

  const hasOTAError = explanations.some(
    (e) => e.category === 'ota'
  );

  if (hasOTAError) {
    return {
      action: 'retry',
      confidence: 0.85,
      reason: [
        'Previous OTA failure detected',
        'Retry OTA with caution',
      ],
    };
  }

  return {
    action: 'allow',
    confidence: 0.7,
    reason: ['No blocking conditions detected'],
  };
};

