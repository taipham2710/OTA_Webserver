// ============================================================================
// OTA POLICY ENGINE
// ============================================================================
// Deterministic policy engine that maps risk_level to OTA decisions.
//
// Architecture:
// - Pure function (no side effects)
// - Deterministic mapping: risk_level → OTA decision
// - No ML knowledge (does not know about anomaly_score, thresholds, etc.)
// - Explainable and auditable
// ============================================================================

/**
 * Determine OTA policy decision based on risk level.
 *
 * @param {string} riskLevel - Risk level from inference service: "low" | "medium" | "high"
 * @returns {Object} Policy decision with:
 *   - decision: "allow" | "delay" | "block"
 *   - reason: Short explanation string
 * @throws {Error} If riskLevel is not a recognized value
 */
export function otaPolicyDecision(riskLevel) {
  if (typeof riskLevel !== 'string') {
    throw new Error(`Invalid riskLevel: expected string, got ${typeof riskLevel}`);
  }

  const normalized = riskLevel.trim().toLowerCase();

  if (normalized === 'low') {
    return {
      decision: 'allow',
      reason: 'System behavior within normal operating range',
    };
  }

  if (normalized === 'medium') {
    return {
      decision: 'delay',
      reason: 'Early anomaly detected, waiting for stabilization',
    };
  }

  if (normalized === 'high') {
    return {
      decision: 'block',
      reason: 'High anomaly risk, OTA blocked',
    };
  }

  throw new Error(`Unknown riskLevel: "${riskLevel}". Expected "low", "medium", or "high"`);
}
