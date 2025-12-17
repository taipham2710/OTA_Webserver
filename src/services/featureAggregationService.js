import { queryMetrics } from './metricsService.js';
import { queryLogs } from './logsService.js';
import { getDb } from '../clients/mongodb.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
          // No OTA events in window, fallback to current status
          const otaStatus = (device.otaStatus || 'completed').toLowerCase();
          if (otaStatus === 'pending' || otaStatus === 'updating') {
            features.ota_updating_pct = 100;
          } else if (otaStatus === 'failed') {
            features.ota_fail_pct = 100;
            features.ota_error_count = 1;
            features.ota_error_pct = 100;
          } else {
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
