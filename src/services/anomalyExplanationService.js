// ============================================================================
// ANOMALY EXPLANATION ENGINE
// ============================================================================
// Rule-based explanation engine that analyzes feature vectors to provide
// human-readable explanations for detected anomalies.
//
// Architecture:
// - Pure rule-based (no ML)
// - Category-based explanations (operational, communication, security, ota)
// - Severity levels: low, medium, high
// - Evidence-based interpretations
// ============================================================================

const severityScore = {
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Build anomaly explanations from feature vector
 * @param {Object} features - Feature vector from buildFeatureVector()
 * @returns {Array} Array of explanation objects
 */
export const buildAnomalyExplanations = (features = {}) => {
  const explanations = [];

  const {
    // Operational
    cpu_usage_mean,
    cpu_spike_ratio,
    mem_spike_ratio,
    storage_mb_min,
    battery_drain_rate,

    // Network
    packet_loss_pct_mean,
    packet_loss_pct_max,
    packet_loss_spike_ratio,
    network_latency_ms_mean,
    latency_spike_ratio,
    rssi_mean,
    rssi_trend,

    // Security
    error_count_mean,
    error_count_max,
    time_gap_avg,

    // OTA
    ota_error_count,
    ota_error_pct,
    ota_fail_pct,
    ota_updating_pct,
  } = features;

  /* ===========================
     OPERATIONAL INSTABILITY
     =========================== */
  if (
    cpu_usage_mean > 80 ||
    cpu_spike_ratio > 0.3 ||
    mem_spike_ratio > 0.3
  ) {
    explanations.push({
      category: 'operational',
      severity: 'medium',
      evidence: {
        cpu_usage_mean,
        cpu_spike_ratio,
        mem_spike_ratio,
      },
      interpretation:
        'High CPU or memory instability detected, device workload may be unstable',
      risk: 'performance_degradation',
    });
  }

  if (storage_mb_min < 100) {
    explanations.push({
      category: 'operational',
      severity: 'high',
      evidence: { storage_mb_min },
      interpretation:
        'Low available storage detected, device may fail during update',
      risk: 'ota_failure',
    });
  }

  if (battery_drain_rate > 5) {
    explanations.push({
      category: 'operational',
      severity: 'medium',
      evidence: { battery_drain_rate },
      interpretation:
        'Rapid battery drain detected, device power stability is degraded',
      risk: 'device_shutdown',
    });
  }

  /* ===========================
     NETWORK / COMMUNICATION
     =========================== */
  if (
    packet_loss_pct_mean > 5 ||
    packet_loss_pct_max > 10 ||
    packet_loss_spike_ratio > 0.2
  ) {
    explanations.push({
      category: 'communication',
      severity: 'high',
      evidence: {
        packet_loss_pct_mean,
        packet_loss_pct_max,
        packet_loss_spike_ratio,
      },
      interpretation:
        'Severe packet loss detected, communication is unstable',
      risk: 'ota_transmission_failure',
    });
  }

  if (
    network_latency_ms_mean > 300 ||
    latency_spike_ratio > 0.2
  ) {
    explanations.push({
      category: 'communication',
      severity: 'medium',
      evidence: {
        network_latency_ms_mean,
        latency_spike_ratio,
      },
      interpretation:
        'High network latency detected, OTA may be delayed or interrupted',
      risk: 'ota_delay',
    });
  }

  if (rssi_mean < -75 || rssi_trend < -0.2) {
    explanations.push({
      category: 'communication',
      severity: 'medium',
      evidence: { rssi_mean, rssi_trend },
      interpretation:
        'Weak or degrading signal strength detected',
      risk: 'connection_instability',
    });
  }

  /* ===========================
     SECURITY / INTEGRITY
     =========================== */
  if (error_count_mean > 5 || error_count_max > 10) {
    explanations.push({
      category: 'security',
      severity: 'high',
      evidence: {
        error_count_mean,
        error_count_max,
      },
      interpretation:
        'High error rate detected, possible abnormal or malicious behavior',
      risk: 'security_risk',
    });
  }

  if (time_gap_avg < 1) {
    explanations.push({
      category: 'security',
      severity: 'medium',
      evidence: { time_gap_avg },
      interpretation:
        'Unusually frequent events detected, possible traffic flood',
      risk: 'abnormal_traffic',
    });
  }

  /* ===========================
     OTA-RELATED
     =========================== */
  if (ota_error_count > 0 || ota_error_pct > 10 || ota_fail_pct > 0) {
    explanations.push({
      category: 'ota',
      severity: 'high',
      evidence: {
        ota_error_count,
        ota_error_pct,
        ota_fail_pct,
      },
      interpretation:
        'OTA failures detected, previous update attempts were unsuccessful',
      risk: 'ota_retry_needed',
    });
  }

  if (ota_updating_pct > 50) {
    explanations.push({
      category: 'ota',
      severity: 'medium',
      evidence: { ota_updating_pct },
      interpretation:
        'Device spends excessive time in updating state',
      risk: 'ota_stuck',
    });
  }

  return explanations;
};

