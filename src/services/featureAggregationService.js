import { queryMetrics } from './metricsService.js';
import { getQueryApi } from '../clients/influxdb.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import fs from 'fs/promises';
import { queryLogs } from './logsService.js';
import { getDb } from '../clients/mongodb.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getMinioClient } from '../clients/minio.js';

// Get current directory for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// LOAD FEATURE LIST FROM feature_list.json
// ============================================================================
/**
 * Load feature list from feature_list.json
 * MVP aggregation: Strict feature compatibility with trained model
 * Safe defaults for online inference
 *
 * NOTE: In container, ensure feature_list.json is mounted at /app/feature_list.json
 * If file doesn't exist, featureList = null and validation is skipped.
 * Since we hard-init all 83 features, inference will still work correctly.
 */
let featureList = null;
try {
  // Try multiple possible paths (development vs container)
  const possiblePaths = [
    join(__dirname, '../../feature_list.json'),  // Development: src/services/../../feature_list.json
    '/app/feature_list.json',                     // Container: mounted at /app
    join(process.cwd(), 'feature_list.json'),    // Current working directory
  ];

  let featureListPath = null;
  let featureListContent = null;

  // Find first existing file
  for (const path of possiblePaths) {
    try {
      // Check if file exists by trying to read it
      featureListContent = readFileSync(path, 'utf-8');
      featureListPath = path;
      break;
    } catch (err) {
      // File doesn't exist at this path, try next
      continue;
    }
  }

  if (featureListContent) {
    featureList = JSON.parse(featureListContent);
    if (!Array.isArray(featureList)) {
      console.warn(`feature_list.json at ${featureListPath} is not an array, skipping validation`);
      featureList = null;
    } else {
      console.log(`Loaded feature_list.json from ${featureListPath} (${featureList.length} features)`);
    }
  } else {
    // File not found at any path - this is OK, we have hard-init features
    console.warn('feature_list.json not found at any expected path. Validation will be skipped.');
    console.warn('Expected paths:', possiblePaths.join(', '));
    console.warn('Inference will still work correctly with hard-init 83 features.');
    featureList = null;
  }
} catch (error) {
  // Parse error or other issue - log but don't fail
  console.warn(`Error loading feature_list.json: ${error.message}. Validation will be skipped.`);
  console.warn('Inference will still work correctly with hard-init 83 features.');
  featureList = null;
}

// ============================================================================
// HELPER FUNCTIONS FOR STATISTICAL COMPUTATIONS
// ============================================================================

/**
 * Calculate mean (average) of values
 */
const mean = (values) => {
  if (!values || values.length === 0) return 0;
  const filtered = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (filtered.length === 0) return 0;
  const sum = filtered.reduce((acc, val) => acc + val, 0);
  return sum / filtered.length;
};

/**
 * Calculate standard deviation
 */
const std = (values) => {
  if (!values || values.length === 0) return 0;
  const filtered = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (filtered.length === 0) return 0;
  const avg = mean(filtered);
  const squareDiffs = filtered.map((val) => {
    const diff = val - avg;
    return diff * diff;
  });
  const avgSquareDiff = mean(squareDiffs);
  return Math.sqrt(avgSquareDiff);
};

/**
 * Calculate median
 */
const median = (values) => {
  if (!values || values.length === 0) return 0;
  const filtered = values.filter(v => v !== null && v !== undefined && !isNaN(v)).sort((a, b) => a - b);
  if (filtered.length === 0) return 0;
  const mid = Math.floor(filtered.length / 2);
  return filtered.length % 2 === 0
    ? (filtered[mid - 1] + filtered[mid]) / 2
    : filtered[mid];
};

/**
 * Calculate minimum value
 */
const min = (values) => {
  if (!values || values.length === 0) return 0;
  const filtered = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (filtered.length === 0) return 0;
  return Math.min(...filtered);
};

/**
 * Calculate maximum value
 */
const max = (values) => {
  if (!values || values.length === 0) return 0;
  const filtered = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (filtered.length === 0) return 0;
  return Math.max(...filtered);
};

/**
 * Calculate percentage of values above threshold
 */
const pctAbove = (values, threshold) => {
  if (!values || values.length === 0) return 0;
  const filtered = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (filtered.length === 0) return 0;
  const aboveCount = filtered.filter(v => v > threshold).length;
  return (aboveCount / filtered.length) * 100;
};

/**
 * Calculate simple linear trend (slope) using least squares
 */
const trendSlope = (values) => {
  if (!values || values.length === 0) return 0;
  const filtered = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (filtered.length < 2) return 0;

  const n = filtered.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = filtered.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * filtered[i], 0);
  const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  return isNaN(slope) ? 0 : slope;
};

/**
 * Calculate spike ratio (percentage of values that are spikes)
 * A spike is defined as a value > mean + 2*std
 */
const spikeRatio = (values) => {
  if (!values || values.length === 0) return 0;
  const filtered = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (filtered.length === 0) return 0;

  const avg = mean(filtered);
  const stdDev = std(filtered);
  const threshold = avg + 2 * stdDev;

  const spikeCount = filtered.filter(v => v > threshold).length;
  return (spikeCount / filtered.length) * 100;
};

/**
 * Calculate delta (difference between last and first value)
 */
const delta = (values) => {
  if (!values || values.length === 0) return 0;
  const filtered = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (filtered.length < 2) return 0;
  return filtered[filtered.length - 1] - filtered[0];
};

/**
 * Calculate rate of change per unit time (delta / time_window)
 * Used for battery_drain_rate, temp_rate, etc.
 */
const rateOfChange = (values, timeWindowMinutes) => {
  if (!values || values.length === 0 || !timeWindowMinutes || timeWindowMinutes <= 0) return 0;
  const deltaValue = delta(values);
  return deltaValue / timeWindowMinutes;
};

// ============================================================================
// FEATURE AGGREGATION SERVICE
// ============================================================================
// MVP aggregation: Strict feature compatibility with trained model
// Safe defaults for online inference - never throws errors
//
// This service aggregates features from multiple data sources:
// - Metrics: InfluxDB (cpu, memory, temperature, battery, storage, uptime, network)
// - Logs: Elasticsearch (error counts per minute buckets)
// - OTA state: MongoDB (device status, OTA history with duration-based percentages)
//
// All features must exactly match feature_list.json (83 features total)
// Missing data is handled with safe defaults (0 or false)
// 15-minute rolling window by default
// ============================================================================

/**
 * Build complete feature vector for anomaly detection
 *
 * MVP aggregation: Strict feature compatibility with trained model
 * Safe defaults for online inference - never throws errors
 *
 * This service aggregates features from multiple data sources:
 * - Metrics: InfluxDB (cpu, memory, temperature, battery, storage, uptime, network)
 * - Logs: Elasticsearch (error counts)
 * - OTA state: MongoDB (device status, OTA history)
 *
 * All features must exactly match feature_list.json (83 features total)
 * Missing data is handled with safe defaults (0 or false)
 *
 * @param {string} deviceId - Device identifier
 * @param {object} options - Optional configuration
 * @param {number} options.windowMinutes - Time window in minutes (default: 15)
 * @returns {Promise<object>} Feature vector with all 83 features matching feature_list.json
 */
export const buildFeatureVector = async (deviceId, options = {}) => {
  // Time-based ML inference is disabled. Use count-based window only.
  console.error('[ML CONTRACT VIOLATION] Time-based ML feature builder invoked (buildFeatureVector). This path is disabled by contract.');
  throw new AppError('ML_CONTRACT_VIOLATION: Time-based ML inference is disabled. Use count-based window only.', 500);

  const windowMinutes = options.windowMinutes || 15;
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMinutes * 60 * 1000);

  // Initialize feature vector with ALL 83 features and safe defaults
  const features = {
    // ========================================================================
    // 1. TIME FEATURES (4 features)
    // ========================================================================
    window_duration_minutes: windowMinutes,
    window_start_hour: windowStart.getHours(),
    window_start_day_of_week: windowStart.getDay(), // 0 = Sunday, 6 = Saturday
    is_weekend: windowStart.getDay() === 0 || windowStart.getDay() === 6,

    // ========================================================================
    // 2. CPU METRICS STATISTICS (6 features)
    // ========================================================================
    cpu_usage_mean: 0,
    cpu_usage_std: 0,
    cpu_usage_min: 0,
    cpu_usage_max: 0,
    cpu_usage_median: 0,
    cpu_usage_high_pct: 0,

    // ========================================================================
    // 3. MEMORY METRICS STATISTICS (5 features)
    // ========================================================================
    mem_usage_mean: 0,
    mem_usage_std: 0,
    mem_usage_min: 0,
    mem_usage_max: 0,
    mem_usage_median: 0,

    // ========================================================================
    // 4. STORAGE METRICS STATISTICS (5 features)
    // ========================================================================
    storage_mb_mean: 0,
    storage_mb_std: 0,
    storage_mb_min: 0,
    storage_mb_max: 0,
    storage_mb_median: 0,

    // ========================================================================
    // 5. BATTERY METRICS STATISTICS (6 features)
    // ========================================================================
    battery_level_mean: 0,
    battery_level_std: 0,
    battery_level_min: 0,
    battery_level_max: 0,
    battery_level_median: 0,
    battery_level_delta: 0,

    // ========================================================================
    // 6. TEMPERATURE METRICS STATISTICS (6 features)
    // ========================================================================
    temperature_mean: 0,
    temperature_std: 0,
    temperature_min: 0,
    temperature_max: 0,
    temperature_median: 0,
    temperature_high_pct: 0,

    // ========================================================================
    // 7. UPTIME METRICS STATISTICS (5 features)
    // ========================================================================
    uptime_hrs_mean: 0,
    uptime_hrs_std: 0,
    uptime_hrs_min: 0,
    uptime_hrs_max: 0,
    uptime_hrs_median: 0,

    // ========================================================================
    // 8. WORKLOAD LEVEL METRICS STATISTICS (5 features)
    // ========================================================================
    workload_level_mean: 0,
    workload_level_std: 0,
    workload_level_min: 0,
    workload_level_max: 0,
    workload_level_median: 0,

    // ========================================================================
    // 9. NETWORK RSSI FEATURES (6 features)
    // ========================================================================
    rssi_mean: 0,
    rssi_std: 0,
    rssi_min: 0,
    rssi_max: 0,
    rssi_median: 0,
    rssi_poor_pct: 0,

    // ========================================================================
    // 10. NETWORK LATENCY FEATURES (6 features)
    // ========================================================================
    network_latency_ms_mean: 0,
    network_latency_ms_std: 0,
    network_latency_ms_min: 0,
    network_latency_ms_max: 0,
    network_latency_ms_median: 0,
    latency_spike_ratio: 0,

    // ========================================================================
    // 11. NETWORK PACKET LOSS FEATURES (6 features)
    // ========================================================================
    packet_loss_pct_mean: 0,
    packet_loss_pct_std: 0,
    packet_loss_pct_min: 0,
    packet_loss_pct_max: 0,
    packet_loss_pct_median: 0,
    packet_loss_pct_high_pct: 0,

    // ========================================================================
    // 12. NETWORK MISSING DATA FEATURES (1 feature)
    // ========================================================================
    network_latency_ms_missing_pct: 0,

    // ========================================================================
    // 13. LOG-DERIVED ERROR FEATURES (5 features)
    // ========================================================================
    error_count_mean: 0,
    error_count_std: 0,
    error_count_min: 0,
    error_count_max: 0,
    error_count_median: 0,

    // ========================================================================
    // 14. TEMPORAL CONSISTENCY FEATURES (2 features)
    // ========================================================================
    time_gap_avg: 0,
    time_gap_std: 0,

    // ========================================================================
    // 15. STABILITY & RATES FEATURES (10 features)
    // ========================================================================
    rssi_trend: 0,
    packet_loss_trend: 0,
    rssi_stability: 0,
    battery_drain_rate: 0,
    temp_rate: 0,
    packet_loss_spike_ratio: 0,
    cpu_spike_ratio: 0,
    mem_spike_ratio: 0,
    workload_change_rate: 0,

    // ========================================================================
    // 16. OTA FEATURES (6 features)
    // ========================================================================
    ota_idle_pct: 0,
    ota_updating_pct: 0,
    ota_success_pct: 0,
    ota_fail_pct: 0,
    ota_error_count: 0,
    ota_error_pct: 0,
  };

  try {
    // ========================================================================
    // QUERY METRICS FROM INFLUXDB
    // ========================================================================
    let metrics = [];
    try {
      metrics = await queryMetrics({
        deviceId,
        start: windowStart,
        end: now,
        limit: 1000,
      });
    } catch (metricsError) {
      console.warn(`Failed to query metrics for feature aggregation: ${metricsError.message}`);
    }

    if (metrics && metrics.length > 0) {
      // Extract metric values from time-series data
      const cpuValues = metrics
        .map(m => m.metrics?.cpu_usage || m.metrics?.cpu)
        .filter(v => v !== null && v !== undefined && !isNaN(v));

      const memoryValues = metrics
        .map(m => m.metrics?.memory_usage || m.metrics?.memory || m.metrics?.mem_usage)
        .filter(v => v !== null && v !== undefined && !isNaN(v));

      const tempValues = metrics
        .map(m => m.metrics?.temperature || m.metrics?.temp)
        .filter(v => v !== null && v !== undefined && !isNaN(v));

      const batteryValues = metrics
        .map(m => m.metrics?.battery_level || m.metrics?.battery)
        .filter(v => v !== null && v !== undefined && !isNaN(v));

      const storageValues = metrics
        .map(m => m.metrics?.storage_usage || m.metrics?.storage || m.metrics?.disk_usage)
        .filter(v => v !== null && v !== undefined && !isNaN(v));

      const uptimeValues = metrics
        .map(m => m.metrics?.uptime)
        .filter(v => v !== null && v !== undefined && !isNaN(v));

      const rssiValues = metrics
        .map(m => m.metrics?.rssi || m.metrics?.signal_strength)
        .filter(v => v !== null && v !== undefined && !isNaN(v));

      const latencyValues = metrics
        .map(m => m.metrics?.latency || m.metrics?.network_latency || m.metrics?.latency_ms)
        .filter(v => v !== null && v !== undefined && !isNaN(v));

      const packetLossValues = metrics
        .map(m => m.metrics?.packet_loss || m.metrics?.packet_loss_pct)
        .filter(v => v !== null && v !== undefined && !isNaN(v));

      // Extract timestamps for temporal analysis
      const timestamps = metrics
        .map(m => m.timestamp ? new Date(m.timestamp).getTime() : null)
        .filter(t => t !== null && !isNaN(t))
        .sort((a, b) => a - b);

      // ====================================================================
      // COMPUTE CPU FEATURES
      // ====================================================================
      if (cpuValues.length > 0) {
        features.cpu_usage_mean = mean(cpuValues);
        features.cpu_usage_std = std(cpuValues);
        features.cpu_usage_min = min(cpuValues);
        features.cpu_usage_max = max(cpuValues);
        features.cpu_usage_median = median(cpuValues);
        features.cpu_usage_high_pct = pctAbove(cpuValues, 80); // High CPU: > 80%
        features.cpu_spike_ratio = spikeRatio(cpuValues);
      }

      // ====================================================================
      // COMPUTE MEMORY FEATURES
      // ====================================================================
      if (memoryValues.length > 0) {
        features.mem_usage_mean = mean(memoryValues);
        features.mem_usage_std = std(memoryValues);
        features.mem_usage_min = min(memoryValues);
        features.mem_usage_max = max(memoryValues);
        features.mem_usage_median = median(memoryValues);
        features.mem_spike_ratio = spikeRatio(memoryValues);
      }

      // ====================================================================
      // COMPUTE STORAGE FEATURES (in MB)
      // ====================================================================
      if (storageValues.length > 0) {
        features.storage_mb_mean = mean(storageValues);
        features.storage_mb_std = std(storageValues);
        features.storage_mb_min = min(storageValues);
        features.storage_mb_max = max(storageValues);
        features.storage_mb_median = median(storageValues);
      }

      // ====================================================================
      // COMPUTE BATTERY FEATURES
      // ====================================================================
      if (batteryValues.length > 0) {
        features.battery_level_mean = mean(batteryValues);
        features.battery_level_std = std(batteryValues);
        features.battery_level_min = min(batteryValues);
        features.battery_level_max = max(batteryValues);
        features.battery_level_median = median(batteryValues);
        features.battery_level_delta = delta(batteryValues);
        // Battery drain rate: rate of change per minute (negative for drain)
        features.battery_drain_rate = rateOfChange(batteryValues, windowMinutes);
      }

      // ====================================================================
      // COMPUTE TEMPERATURE FEATURES
      // ====================================================================
      if (tempValues.length > 0) {
        features.temperature_mean = mean(tempValues);
        features.temperature_std = std(tempValues);
        features.temperature_min = min(tempValues);
        features.temperature_max = max(tempValues);
        features.temperature_median = median(tempValues);
        features.temperature_high_pct = pctAbove(tempValues, 70); // High temp: > 70°C
        features.temp_rate = rateOfChange(tempValues, windowMinutes);
      }

      // ====================================================================
      // COMPUTE UPTIME FEATURES (in hours)
      // ====================================================================
      if (uptimeValues.length > 0) {
        // Convert minutes to hours for uptime
        const uptimeHours = uptimeValues.map(v => v / 60);
        features.uptime_hrs_mean = mean(uptimeHours);
        features.uptime_hrs_std = std(uptimeHours);
        features.uptime_hrs_min = min(uptimeHours);
        features.uptime_hrs_max = max(uptimeHours);
        features.uptime_hrs_median = median(uptimeHours);
      }

      // ====================================================================
      // COMPUTE WORKLOAD LEVEL FEATURES
      // ====================================================================
      // Workload level is typically derived from CPU usage
      if (cpuValues.length > 0) {
        features.workload_level_mean = mean(cpuValues);
        features.workload_level_std = std(cpuValues);
        features.workload_level_min = min(cpuValues);
        features.workload_level_max = max(cpuValues);
        features.workload_level_median = median(cpuValues);
      }

      // ====================================================================
      // COMPUTE NETWORK RSSI FEATURES
      // ====================================================================
      if (rssiValues.length > 0) {
        features.rssi_mean = mean(rssiValues);
        features.rssi_std = std(rssiValues);
        features.rssi_min = min(rssiValues);
        features.rssi_max = max(rssiValues);
        features.rssi_median = median(rssiValues);
        // Poor RSSI: typically < -80 dBm
        features.rssi_poor_pct = pctAbove(rssiValues.map(v => -v), 80); // Invert for threshold check
        features.rssi_trend = trendSlope(rssiValues);
        // RSSI stability: inverse of std (lower std = higher stability)
        const rssiStd = std(rssiValues);
        features.rssi_stability = rssiStd > 0 ? 100 / (1 + rssiStd) : 100;
      }

      // ====================================================================
      // COMPUTE NETWORK LATENCY FEATURES
      // ====================================================================
      if (latencyValues.length > 0) {
        features.network_latency_ms_mean = mean(latencyValues);
        features.network_latency_ms_std = std(latencyValues);
        features.network_latency_ms_min = min(latencyValues);
        features.network_latency_ms_max = max(latencyValues);
        features.network_latency_ms_median = median(latencyValues);
        features.latency_spike_ratio = spikeRatio(latencyValues);
      }

      // Calculate missing latency percentage
      const totalExpectedMetrics = Math.ceil(windowMinutes); // Assume 1 metric per minute expected
      const actualLatencyMetrics = latencyValues.length;
      features.network_latency_ms_missing_pct = totalExpectedMetrics > 0
        ? ((totalExpectedMetrics - actualLatencyMetrics) / totalExpectedMetrics) * 100
        : 0;

      // ====================================================================
      // COMPUTE PACKET LOSS FEATURES
      // ====================================================================
      if (packetLossValues.length > 0) {
        features.packet_loss_pct_mean = mean(packetLossValues);
        features.packet_loss_pct_std = std(packetLossValues);
        features.packet_loss_pct_min = min(packetLossValues);
        features.packet_loss_pct_max = max(packetLossValues);
        features.packet_loss_pct_median = median(packetLossValues);
        // High packet loss: > 5%
        features.packet_loss_pct_high_pct = pctAbove(packetLossValues, 5);
        // NOTE: feature_list.json expects 'packet_loss_spike_ratio'
        // Use spike ratio of packet loss as-is (no '_pct_' in key name)
        features.packet_loss_spike_ratio = spikeRatio(packetLossValues);
        features.packet_loss_trend = trendSlope(packetLossValues);
      }

      // ====================================================================
      // COMPUTE TEMPORAL CONSISTENCY FEATURES
      // ====================================================================
      if (timestamps.length > 1) {
        const timeGaps = [];
        for (let i = 1; i < timestamps.length; i++) {
          const gap = (timestamps[i] - timestamps[i - 1]) / 1000; // Convert to seconds
          if (gap > 0) {
            timeGaps.push(gap);
          }
        }
        if (timeGaps.length > 0) {
          features.time_gap_avg = mean(timeGaps);
          features.time_gap_std = std(timeGaps);
        }
      }

      // ====================================================================
      // COMPUTE WORKLOAD CHANGE RATE
      // ====================================================================
      // Workload change rate: coefficient of variation in CPU usage
      if (cpuValues.length > 1) {
        const cpuStd = std(cpuValues);
        const cpuMean = mean(cpuValues);
        // Coefficient of variation as workload change rate
        features.workload_change_rate = cpuMean > 0 ? (cpuStd / cpuMean) * 100 : 0;
      }
    }

    // ========================================================================
    // QUERY LOGS FROM ELASTICSEARCH
    // ========================================================================
    let logs = [];
    try {
      logs = await queryLogs({
        deviceId,
        start: windowStart,
        end: now,
        limit: 1000,
      });
    } catch (logsError) {
      console.warn(`Failed to query logs for feature aggregation: ${logsError.message}`);
    }

    if (logs && logs.length > 0) {
      // Filter error logs
      const errorLogs = logs.filter(log =>
        log.level && log.level.toLowerCase() === 'error'
      );

      // Bucket errors by 1-minute intervals for statistics
      const bucketSizeMs = 60 * 1000; // 1 minute
      const buckets = {};

      errorLogs.forEach(log => {
        // Use @timestamp from Elasticsearch data stream (fallback to timestamp for compatibility)
        const timestampValue = log['@timestamp'] || log.timestamp;
        if (timestampValue) {
          const logTime = new Date(timestampValue).getTime();
          const bucketKey = Math.floor(logTime / bucketSizeMs) * bucketSizeMs;
          buckets[bucketKey] = (buckets[bucketKey] || 0) + 1;
        }
      });

      const errorCounts = Object.values(buckets);

      if (errorCounts.length > 0) {
        features.error_count_mean = mean(errorCounts);
        features.error_count_std = std(errorCounts);
        features.error_count_min = min(errorCounts);
        features.error_count_max = max(errorCounts);
        features.error_count_median = median(errorCounts);
      }
    }

    // ========================================================================
    // QUERY OTA STATUS FROM MONGODB
    // ========================================================================
    // MVP aggregation: Derive OTA percentages from status duration in window
    // If unavailable, fallback to current status
    try {
      const db = await getDb();
      const devicesCollection = db.collection('devices');
      const device = await devicesCollection.findOne({ deviceId });

      if (device) {
        // Query OTA history for the time window
        const otaHistoryCollection = db.collection('ota_history');
        const otaEvents = await otaHistoryCollection
          .find({
            deviceId,
            $or: [
              { timestamp: { $gte: windowStart, $lte: now } },
              { deployedAt: { $gte: windowStart, $lte: now } },
            ],
          })
          .sort({ timestamp: 1, deployedAt: 1 })
          .toArray();

        const windowDurationMs = windowMinutes * 60 * 1000;

        if (otaEvents.length > 0) {
          // Calculate time spent in each state from events
          let idleTime = 0;
          let updatingTime = 0;
          let successTime = 0;
          let failTime = 0;
          let errorCount = 0;

          // Process events to calculate duration in each state
          for (let i = 0; i < otaEvents.length; i++) {
            const event = otaEvents[i];
            const eventTime = event.timestamp ? new Date(event.timestamp).getTime() :
                            (event.deployedAt ? new Date(event.deployedAt).getTime() : windowStart.getTime());
            const nextEventTime = i < otaEvents.length - 1
              ? (otaEvents[i + 1].timestamp ? new Date(otaEvents[i + 1].timestamp).getTime() :
                 (otaEvents[i + 1].deployedAt ? new Date(otaEvents[i + 1].deployedAt).getTime() : now.getTime()))
              : now.getTime();
            const duration = Math.max(0, Math.min(nextEventTime - eventTime, windowDurationMs));

            const status = (event.status || '').toLowerCase();
            if (status === 'completed' || status === 'idle') {
              idleTime += duration;
              if (event.success === true) successTime += duration;
            } else if (status === 'updating' || status === 'pending') {
              updatingTime += duration;
            } else if (status === 'failed') {
              failTime += duration;
              errorCount++;
            } else if (status === 'error') {
              errorCount++;
            }
          }

          // Calculate percentages based on time duration
          features.ota_idle_pct = (idleTime / windowDurationMs) * 100;
          features.ota_updating_pct = (updatingTime / windowDurationMs) * 100;
          features.ota_success_pct = (successTime / windowDurationMs) * 100;
          features.ota_fail_pct = (failTime / windowDurationMs) * 100;
          features.ota_error_count = errorCount;
          features.ota_error_pct = (errorCount / otaEvents.length) * 100;
        } else {
          // No OTA events in window, fallback to current firmware status
          // Read from new device.firmware.status schema
          const firmwareStatus = (device.firmware?.status || 'idle').toLowerCase();
          if (firmwareStatus === 'pending' || firmwareStatus === 'downloading' || firmwareStatus === 'updating') {
            features.ota_updating_pct = 100;
          } else if (firmwareStatus === 'failed') {
            features.ota_fail_pct = 100;
            features.ota_error_count = 1;
            features.ota_error_pct = 100;
          } else {
            // idle, success, or unknown → treat as idle/completed
            features.ota_idle_pct = 100;
            features.ota_success_pct = 100;
          }
        }
      }
    } catch (otaError) {
      console.warn(`Failed to query OTA status for feature aggregation: ${otaError.message}`);
      // Keep defaults (all 0) - safe defaults for online inference
    }

  } catch (error) {
    // NEVER throw - always return valid feature vector with defaults
    console.warn(`Feature aggregation error for device ${deviceId}: ${error.message}`);
  }

  // Ensure all features are numbers (not NaN or Infinity)
  for (const key in features) {
    const value = features[key];
    if (typeof value === 'number' && (isNaN(value) || !isFinite(value))) {
      features[key] = 0;
    } else if (typeof value === 'boolean') {
      features[key] = value ? 1 : 0; // Convert boolean to number
    }
  }

  // ========================================================================
  // VALIDATE FEATURE COMPLETENESS AGAINST feature_list.json
  // ========================================================================
  // MVP aggregation: Strict feature compatibility with trained model
  // Safe defaults for online inference - ensure Object.keys(features).length === feature_list.length
  //
  // NOTE: feature_list.json is the single source of truth.
  // We:
  // - Log EXTRA features (present in features but not in feature_list.json)
  // - Log MISSING features (present in feature_list.json but not in features)
  // - Drop extra features
  // - Add missing features with safe default 0
  //
  // After this block, Object.keys(features).length MUST equal feature_list.length.
  if (featureList && Array.isArray(featureList) && featureList.length > 0) {
    const featureKeysBefore = Object.keys(features);

    const extraFeatures = featureKeysBefore.filter(
      (f) => !featureList.includes(f),
    );
    const missingFeatures = featureList.filter(
      (f) => typeof f === 'string' && !(f in features),
    );

    console.log('[ML] extra features:', extraFeatures);
    console.log('[ML] missing features:', missingFeatures);
    console.log('[ML] feature count before fix:', featureKeysBefore.length);

    // Remove extra features so we exactly match model expectation
    for (const extra of extraFeatures) {
      delete features[extra];
    }

    // Add all missing features with safe default 0
    for (const missing of missingFeatures) {
      features[missing] = 0;
    }

    const finalKeys = Object.keys(features);
    console.log('[ML] feature count after fix:', finalKeys.length);

    if (finalKeys.length === featureList.length) {
      console.log(
        `[ML] feature validation passed: ${finalKeys.length} features match feature_list.json`,
      );
    } else {
      console.error(
        `[ML] CRITICAL: Feature count mismatched after fix: expected ${featureList.length}, got ${finalKeys.length}`,
      );
    }
  } else {
    // feature_list.json not available - this is OK, we have hard-init features
    // Log at debug level since this is expected in some deployment scenarios
    console.debug(
      '[ML] feature_list.json not available - validation skipped. Using hard-init 83 features.',
    );
  }

  return features;
};

// =============================================================================
// ML INFERENCE FEATURE VECTOR (Isolation Forest training contract)
// - Count-based windowing (10 events, stride=1 semantics => use most recent window)
// - Uses event timestamps (NOT arrival time) for time-gap features
// - Emits 77 base features + 77 _present masks, interleaved, ordered by feature_list.json
// =============================================================================

const WINDOW_SIZE_EVENTS = 10;

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

// Load feature_list.json from current model in MinIO (source of truth)
const readFeatureList = async () => {
  const BUCKET = 'models';
  const CURRENT_OBJECT = 'current';
  
  // Resolve current model version
  const client = getMinioClient();
  let version;
  try {
    const currentStream = await client.getObject(BUCKET, CURRENT_OBJECT);
    const chunks = [];
    for await (const chunk of currentStream) {
      chunks.push(chunk);
    }
    version = Buffer.concat(chunks).toString('utf-8').trim();
    if (!version) {
      throw new AppError('models/current is empty', 500);
    }
    // Validate version exists
    await client.statObject(BUCKET, `${version}/metadata.json`);
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
      throw new AppError(`Model version not found: ${error.message}`, 500);
    }
    throw new AppError(`Failed to resolve current model version: ${error.message}`, 500);
  }
  
  // Load feature_list.json from model directory
  let featureListStream;
  try {
    featureListStream = await client.getObject(BUCKET, `${version}/feature_list.json`);
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
      throw new AppError(`feature_list.json not found for model ${version}`, 500);
    }
    throw new AppError(`Failed to load feature_list.json: ${error.message}`, 500);
  }
  
  const chunks = [];
  for await (const chunk of featureListStream) {
    chunks.push(chunk);
  }
  const content = Buffer.concat(chunks).toString('utf-8');
  const data = JSON.parse(content);
  
  if (!Array.isArray(data)) {
    throw new AppError('feature_list.json must be an array', 500);
  }
  
  if (data.length === 0) {
    throw new AppError('feature_list.json is empty', 500);
  }
  
  console.log(`[FeatureAggregation] Loaded feature_list.json from model ${version} (${data.length} features)`);
  return data;
};

const fetchRecentMetricEvents = async (deviceId, runId = null) => {
  const queryApi = getQueryApi();

  // Pivot to get one row per timestamp (event) with all metric fields.
  const runIdFilter = runId
    ? `      |> filter(fn: (r) => r.runId == "${runId}")`
    : '';

  const fluxQuery = `
    from(bucket: "${config.influx.bucket}")
      |> range(start: -365d)
      |> filter(fn: (r) => r._measurement == "device_metrics")
      |> filter(fn: (r) => r.deviceId == "${deviceId}")
${runIdFilter}
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: ${WINDOW_SIZE_EVENTS})
      |> sort(columns: ["_time"])
  `;

  const rows = [];
  await new Promise((resolve, reject) => {
    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        rows.push(tableMeta.toObject(row));
      },
      error: reject,
      complete: resolve,
    });
  });

  return rows.map((r) => {
    const timestamp = r._time ? new Date(r._time) : null;
    const metrics = { ...r };
    delete metrics._time;
    delete metrics.result;
    delete metrics.table;
    delete metrics._start;
    delete metrics._stop;
    delete metrics._measurement;
    delete metrics.deviceId;

    return {
      timestamp,
      timestamp_provided: r.timestamp_provided,
      metrics,
    };
  });
};

const normalizeRawMetrics = (eventMetrics) => {
  const m = eventMetrics && typeof eventMetrics === 'object' && !Array.isArray(eventMetrics) ? eventMetrics : {};

  const pick = (keys) => {
    for (const k of keys) {
      const v = m[k];
      if (isFiniteNumber(v)) return v;
    }
    return null;
  };

  return {
    cpu_usage: pick(['cpu_usage', 'cpu']),
    mem_usage: pick(['mem_usage', 'memory_usage', 'memory']),
    storage_mb: pick(['storage_mb', 'storage_usage', 'storage', 'disk_usage']),
    battery_level: pick(['battery_level', 'battery']),
    temperature: pick(['temperature', 'temp']),
    uptime_hrs: pick(['uptime_hrs', 'uptime_hours']),
    workload_level: pick(['workload_level']),
    error_count: pick(['error_count']),
    rssi: pick(['rssi', 'signal_strength']),
    network_latency_ms: pick(['network_latency_ms', 'network_latency', 'latency_ms', 'latency']),
    packet_loss_pct: pick(['packet_loss_pct', 'packet_loss']),
  };
};

const computePresent = (events, rawKey) => {
  return events.some((e) => isFiniteNumber(e.raw?.[rawKey])) ? 1 : 0;
};

// Helper function to compute feature value from aggregated metrics
// Maps model feature names to computed values from window events
const computeFeatureValue = (featureName, aggregatedMetrics, windowEvents, timestampsMs, windowMinutes) => {
  const { cpu, mem, storage, battery, temp, uptime, workload, errorCount, rssi, latency, packetLoss, firstTs } = aggregatedMetrics;
  
  // Direct match (exact feature name exists in aggregated metrics)
  if (aggregatedMetrics[featureName] !== undefined) {
    return aggregatedMetrics[featureName];
  }
  
  // Flexible name matching for common patterns
  // CPU features: cpu_mean -> cpu_usage_mean, cpu_std -> cpu_usage_std, etc.
  if (featureName.startsWith('cpu_')) {
    const suffix = featureName.replace('cpu_', '');
    const mappedName = `cpu_usage_${suffix}`;
    if (aggregatedMetrics[mappedName] !== undefined) {
      return aggregatedMetrics[mappedName];
    }
    if (cpu && cpu.length > 0) {
      if (suffix === 'mean') return mean(cpu);
      if (suffix === 'std') return std(cpu);
      if (suffix === 'min') return min(cpu);
      if (suffix === 'max') return max(cpu);
    }
  }
  
  // Memory features: memory_mean -> mem_usage_mean, etc.
  if (featureName.startsWith('memory_')) {
    const suffix = featureName.replace('memory_', '');
    const mappedName = `mem_usage_${suffix}`;
    if (aggregatedMetrics[mappedName] !== undefined) {
      return aggregatedMetrics[mappedName];
    }
    if (mem && mem.length > 0) {
      if (suffix === 'mean') return mean(mem);
      if (suffix === 'std') return std(mem);
      if (suffix === 'min') return min(mem);
      if (suffix === 'max') return max(mem);
    }
  }
  
  // Temperature features
  if (featureName.startsWith('temperature_')) {
    const suffix = featureName.replace('temperature_', '');
    const mappedName = `temperature_${suffix}`;
    if (aggregatedMetrics[mappedName] !== undefined) {
      return aggregatedMetrics[mappedName];
    }
    if (temp && temp.length > 0) {
      if (suffix === 'mean') return mean(temp);
      if (suffix === 'std') return std(temp);
      if (suffix === 'min') return min(temp);
      if (suffix === 'max') return max(temp);
    }
  }
  
  // Latency features: latency_mean -> network_latency_ms_mean, etc.
  if (featureName.startsWith('latency_')) {
    const suffix = featureName.replace('latency_', '');
    const mappedName = `network_latency_ms_${suffix}`;
    if (aggregatedMetrics[mappedName] !== undefined) {
      return aggregatedMetrics[mappedName];
    }
    if (latency && latency.length > 0) {
      if (suffix === 'mean') return mean(latency);
      if (suffix === 'std') return std(latency);
      if (suffix === 'min') return min(latency);
      if (suffix === 'max') return max(latency);
    }
  }
  
  // Packet loss features: packet_loss_mean -> packet_loss_pct_mean, etc.
  if (featureName.startsWith('packet_loss_')) {
    const suffix = featureName.replace('packet_loss_', '');
    const mappedName = `packet_loss_pct_${suffix}`;
    if (aggregatedMetrics[mappedName] !== undefined) {
      return aggregatedMetrics[mappedName];
    }
    if (packetLoss && packetLoss.length > 0) {
      if (suffix === 'mean') return mean(packetLoss);
      if (suffix === 'std') return std(packetLoss);
      if (suffix === 'min') return min(packetLoss);
      if (suffix === 'max') return max(packetLoss);
    }
  }
  
  // Derived features
  if (featureName === 'cpu_memory_ratio') {
    if (cpu && cpu.length > 0 && mem && mem.length > 0) {
      const cpuMean = mean(cpu);
      const memMean = mean(mem);
      return memMean > 0 ? cpuMean / memMean : 0;
    }
  }
  
  if (featureName === 'latency_packet_correlation') {
    if (latency && latency.length > 0 && packetLoss && packetLoss.length > 0 && latency.length === packetLoss.length) {
      const latencyMean = mean(latency);
      const packetLossMean = mean(packetLoss);
      let covariance = 0;
      for (let i = 0; i < latency.length; i++) {
        covariance += (latency[i] - latencyMean) * (packetLoss[i] - packetLossMean);
      }
      const latencyStd = std(latency);
      const packetLossStd = std(packetLoss);
      if (latencyStd > 0 && packetLossStd > 0) {
        return covariance / (latency.length * latencyStd * packetLossStd);
      }
    }
  }
  
  if (featureName === 'temperature_variance') {
    if (temp && temp.length > 0) {
      const tempStd = std(temp);
      return tempStd * tempStd;
    }
  }
  
  if (featureName === 'missing_ratio') {
    const expected = windowEvents.length > 0 ? windowEvents.length : 1;
    let missingCount = 0;
    for (const event of windowEvents) {
      const hasAnyMetric = Object.values(event.raw || {}).some(v => isFiniteNumber(v));
      if (!hasAnyMetric) missingCount++;
    }
    return expected > 0 ? (missingCount / expected) : 0;
  }
  
  if (featureName === 'variance_score') {
    const allValues = [];
    for (const event of windowEvents) {
      const raw = event.raw || {};
      for (const v of Object.values(raw)) {
        if (isFiniteNumber(v)) allValues.push(v);
      }
    }
    if (allValues.length > 0) {
      const overallStd = std(allValues);
      return overallStd * overallStd;
    }
  }
  
  if (featureName === 'correlation_strength') {
    if (cpu && cpu.length > 0 && mem && mem.length > 0 && cpu.length === mem.length) {
      const cpuMean = mean(cpu);
      const memMean = mean(mem);
      let covariance = 0;
      for (let i = 0; i < cpu.length; i++) {
        covariance += (cpu[i] - cpuMean) * (mem[i] - memMean);
      }
      const cpuStd = std(cpu);
      const memStd = std(mem);
      if (cpuStd > 0 && memStd > 0) {
        return Math.abs(covariance / (cpu.length * cpuStd * memStd));
      }
    }
  }
  
  // Time features
  if (featureName === 'window_duration_minutes') {
    return windowMinutes;
  }
  if (firstTs && featureName === 'window_start_hour') {
    return firstTs.getUTCHours();
  }
  if (firstTs && featureName === 'window_start_day_of_week') {
    return firstTs.getUTCDay();
  }
  if (firstTs && featureName === 'is_weekend') {
    return (firstTs.getUTCDay() === 0 || firstTs.getUTCDay() === 6) ? 1 : 0;
  }
  
  // Time gap features
  if (featureName === 'time_gap_avg' && timestampsMs.length > 1) {
    const gaps = [];
    for (let i = 1; i < timestampsMs.length; i += 1) {
      const gapSec = (timestampsMs[i] - timestampsMs[i - 1]) / 1000;
      if (gapSec > 0) gaps.push(gapSec);
    }
    if (gaps.length > 0) return mean(gaps);
  }
  if (featureName === 'time_gap_std' && timestampsMs.length > 1) {
    const gaps = [];
    for (let i = 1; i < timestampsMs.length; i += 1) {
      const gapSec = (timestampsMs[i] - timestampsMs[i - 1]) / 1000;
      if (gapSec > 0) gaps.push(gapSec);
    }
    if (gaps.length > 0) return std(gaps);
  }
  
  // Default: feature not found, return 0
  return 0;
};

export const buildMlInferenceVector = async (deviceId, options = {}) => {
  const { runId = null } = options;
  // Load feature_list.json from current model in MinIO (source of truth)
  const featureList = await readFeatureList();
  
  if (!Array.isArray(featureList) || featureList.length === 0) {
    throw new AppError('feature_list.json must be a non-empty array', 500);
  }

  const rawEvents = await fetchRecentMetricEvents(deviceId, runId);
  if (!rawEvents.length) {
    throw new AppError('No metrics events available for ML inference', 400);
  }

  // ML input contract requires explicit timestamp provenance per event.
  // `timestamp_provided` is persisted by metrics ingest when metricsData.timestamp is present.
  const anyMissingTimestampProvenance = rawEvents.some((e) => e.timestamp_provided !== true);
  if (anyMissingTimestampProvenance) {
    throw new AppError(
      'ML_CONTRACT_VIOLATION: timestamp provenance missing (expected timestamp_provided === true for all events).',
      400,
    );
  }

  const events = rawEvents
    .filter((e) => e.timestamp instanceof Date && !Number.isNaN(e.timestamp.getTime()))
    .map((e) => ({ ...e, raw: normalizeRawMetrics(e.metrics) }))
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // HARD GATE: inference requires a fully populated window.
  if (events.length < WINDOW_SIZE_EVENTS) {
    console.warn('[ML_WINDOW_INFO]', {
      deviceId,
      runId,
      totalEvents: rawEvents.length,
      usableEvents: events.length,
      requiredEvents: WINDOW_SIZE_EVENTS,
      firstTs: events[0]?.timestamp ?? null,
      lastTs: events[events.length - 1]?.timestamp ?? null,
    });
    throw new AppError(
      `ML_CONTRACT_VIOLATION: underfilled window (have=${events.length}, need=${WINDOW_SIZE_EVENTS})`,
      400,
    );
  }

  // Window size = 10 events; if more, use the most recent window.
  const windowEvents = events.length <= WINDOW_SIZE_EVENTS ? events : events.slice(-WINDOW_SIZE_EVENTS);

  console.log('[ML_WINDOW_INFO]', {
    deviceId,
    runId,
    totalEvents: rawEvents.length,
    usableEvents: events.length,
    windowSize: WINDOW_SIZE_EVENTS,
    firstTs: windowEvents[0]?.timestamp ?? null,
    lastTs: windowEvents[windowEvents.length - 1]?.timestamp ?? null,
  });

  const firstTs = windowEvents[0]?.timestamp ?? null;
  const lastTs = windowEvents[windowEvents.length - 1]?.timestamp ?? null;
  const windowMinutes = (firstTs && lastTs) ? Math.max(0, (lastTs.getTime() - firstTs.getTime()) / 60000) : 0;

  const values = (rawKey) =>
    windowEvents.map((e) => e.raw?.[rawKey]).filter((v) => isFiniteNumber(v));

  const cpu = values('cpu_usage');
  const mem = values('mem_usage');
  const storage = values('storage_mb');
  const battery = values('battery_level');
  const temp = values('temperature');
  const uptime = values('uptime_hrs');
  const workload = values('workload_level');
  const errorCount = values('error_count');
  const rssi = values('rssi');
  const latency = values('network_latency_ms');
  const packetLoss = values('packet_loss_pct');

  const timestampsMs = windowEvents.map((e) => e.timestamp.getTime()).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);

  // Build aggregated metrics object (for backward compatibility with existing aggregation logic)
  const aggregatedMetrics = {
    cpu,
    mem,
    storage,
    battery,
    temp,
    uptime,
    workload,
    errorCount,
    rssi,
    latency,
    packetLoss,
    firstTs,
  };


  // Pre-compute common aggregated features (for backward compatibility)
  if (cpu.length) {
    aggregatedMetrics.cpu_usage_mean = mean(cpu);
    aggregatedMetrics.cpu_usage_std = std(cpu);
    aggregatedMetrics.cpu_usage_min = min(cpu);
    aggregatedMetrics.cpu_usage_max = max(cpu);
    aggregatedMetrics.cpu_usage_median = median(cpu);
    aggregatedMetrics.cpu_usage_high_pct = pctAbove(cpu, 80);
    aggregatedMetrics.cpu_spike_ratio = spikeRatio(cpu);
  }
  if (mem.length) {
    aggregatedMetrics.mem_usage_mean = mean(mem);
    aggregatedMetrics.mem_usage_std = std(mem);
    aggregatedMetrics.mem_usage_min = min(mem);
    aggregatedMetrics.mem_usage_max = max(mem);
    aggregatedMetrics.mem_usage_median = median(mem);
    aggregatedMetrics.mem_spike_ratio = spikeRatio(mem);
  }
  if (storage.length) {
    aggregatedMetrics.storage_mb_mean = mean(storage);
    aggregatedMetrics.storage_mb_std = std(storage);
    aggregatedMetrics.storage_mb_min = min(storage);
    aggregatedMetrics.storage_mb_max = max(storage);
    aggregatedMetrics.storage_mb_median = median(storage);
  }
  if (battery.length) {
    aggregatedMetrics.battery_level_mean = mean(battery);
    aggregatedMetrics.battery_level_std = std(battery);
    aggregatedMetrics.battery_level_min = min(battery);
    aggregatedMetrics.battery_level_max = max(battery);
    aggregatedMetrics.battery_level_median = median(battery);
    aggregatedMetrics.battery_level_delta = delta(battery);
    aggregatedMetrics.battery_drain_rate = windowMinutes > 0 ? rateOfChange(battery, windowMinutes) : 0;
  }
  if (temp.length) {
    aggregatedMetrics.temperature_mean = mean(temp);
    aggregatedMetrics.temperature_std = std(temp);
    aggregatedMetrics.temperature_min = min(temp);
    aggregatedMetrics.temperature_max = max(temp);
    aggregatedMetrics.temperature_median = median(temp);
    aggregatedMetrics.temperature_high_pct = pctAbove(temp, 70);
    aggregatedMetrics.temp_rate = windowMinutes > 0 ? rateOfChange(temp, windowMinutes) : 0;
  }
  if (uptime.length) {
    aggregatedMetrics.uptime_hrs_mean = mean(uptime);
    aggregatedMetrics.uptime_hrs_std = std(uptime);
    aggregatedMetrics.uptime_hrs_min = min(uptime);
    aggregatedMetrics.uptime_hrs_max = max(uptime);
    aggregatedMetrics.uptime_hrs_median = median(uptime);
  }
  if (workload.length) {
    aggregatedMetrics.workload_level_mean = mean(workload);
    aggregatedMetrics.workload_level_std = std(workload);
    aggregatedMetrics.workload_level_min = min(workload);
    aggregatedMetrics.workload_level_max = max(workload);
    aggregatedMetrics.workload_level_median = median(workload);
    if (cpu.length > 1) {
      const cpuStd = std(cpu);
      const cpuMean = mean(cpu);
      aggregatedMetrics.workload_change_rate = cpuMean > 0 ? (cpuStd / cpuMean) * 100 : 0;
    }
  }
  if (errorCount.length) {
    aggregatedMetrics.error_count_mean = mean(errorCount);
    aggregatedMetrics.error_count_std = std(errorCount);
    aggregatedMetrics.error_count_min = min(errorCount);
    aggregatedMetrics.error_count_max = max(errorCount);
    aggregatedMetrics.error_count_median = median(errorCount);
  }
  if (rssi.length) {
    aggregatedMetrics.rssi_mean = mean(rssi);
    aggregatedMetrics.rssi_std = std(rssi);
    aggregatedMetrics.rssi_min = min(rssi);
    aggregatedMetrics.rssi_max = max(rssi);
    aggregatedMetrics.rssi_median = median(rssi);
    aggregatedMetrics.rssi_poor_pct = pctAbove(rssi.map((v) => -v), 80);
    aggregatedMetrics.rssi_trend = trendSlope(rssi);
    const rssiStd = std(rssi);
    aggregatedMetrics.rssi_stability = rssiStd > 0 ? 100 / (1 + rssiStd) : 100;
  }
  if (latency.length) {
    aggregatedMetrics.network_latency_ms_mean = mean(latency);
    aggregatedMetrics.network_latency_ms_std = std(latency);
    aggregatedMetrics.network_latency_ms_min = min(latency);
    aggregatedMetrics.network_latency_ms_max = max(latency);
    aggregatedMetrics.network_latency_ms_median = median(latency);
    aggregatedMetrics.latency_spike_ratio = spikeRatio(latency);
  }
  {
    const expected = windowEvents.length > 0 ? windowEvents.length : 1;
    const actual = latency.length;
    aggregatedMetrics.network_latency_ms_missing_pct = expected > 0 ? ((expected - actual) / expected) * 100 : 0;
  }
  if (packetLoss.length) {
    aggregatedMetrics.packet_loss_pct_mean = mean(packetLoss);
    aggregatedMetrics.packet_loss_pct_std = std(packetLoss);
    aggregatedMetrics.packet_loss_pct_min = min(packetLoss);
    aggregatedMetrics.packet_loss_pct_max = max(packetLoss);
    aggregatedMetrics.packet_loss_pct_median = median(packetLoss);
    aggregatedMetrics.packet_loss_pct_high_pct = pctAbove(packetLoss, 5);
    aggregatedMetrics.packet_loss_spike_ratio = spikeRatio(packetLoss);
    aggregatedMetrics.packet_loss_trend = trendSlope(packetLoss);
  }
  if (timestampsMs.length > 1) {
    const gaps = [];
    for (let i = 1; i < timestampsMs.length; i += 1) {
      const gapSec = (timestampsMs[i] - timestampsMs[i - 1]) / 1000;
      if (gapSec > 0) gaps.push(gapSec);
    }
    if (gaps.length) {
      aggregatedMetrics.time_gap_avg = mean(gaps);
      aggregatedMetrics.time_gap_std = std(gaps);
    }
  }

  // Build feature vector strictly following feature_list.json order
  // DO NOT assume _present masks exist - only include features that exist in feature_list.json
  const out = {};
  for (const featureName of featureList) {
    // Skip invalid feature names
    if (typeof featureName !== 'string') {
      continue;
    }
    
    // Compute feature value
    const value = computeFeatureValue(featureName, aggregatedMetrics, windowEvents, timestampsMs, windowMinutes);
    out[featureName] = isFiniteNumber(value) ? value : 0;
  }

  // Contract assertions: exact feature names, order, and numeric values only
  const actualOrder = Object.keys(out);
  if (actualOrder.length !== featureList.length) {
    throw new AppError(
      `ML CONTRACT VIOLATION: feature vector length mismatch (expected=${featureList.length}, actual=${actualOrder.length})`,
      500,
    );
  }
  for (let i = 0; i < featureList.length; i += 1) {
    if (actualOrder[i] !== featureList[i]) {
      throw new AppError(
        `ML CONTRACT VIOLATION: feature order mismatch at index=${i} (expected=${featureList[i]}, actual=${actualOrder[i]})`,
        500,
      );
    }
  }
  for (const [k, v] of Object.entries(out)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new AppError(
        `ML CONTRACT VIOLATION: non-numeric feature value for ${k}`,
        500,
      );
    }
  }

  return out;
};

// Public name for ML inference (count-based) to match training contract.
export const buildFeatureVectorCountBased = buildMlInferenceVector;
