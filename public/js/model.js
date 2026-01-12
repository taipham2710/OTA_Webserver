import { api } from './api.js';
import { ui } from './ui.js';

let refreshInterval = null;

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const formatNumber = (value, decimals = 6) => {
  if (!isFiniteNumber(value)) return null;
  return value.toFixed(decimals);
};

const formatBool = (value) => {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return null;
};

const safeFormatDate = (value) => {
  if (typeof value !== 'string') return null;
  try {
    return ui.formatDate(value);
  } catch {
    return value;
  }
};

const extractThresholdStrategy = (model) => {
  const threshold = model?.threshold;
  if (!isPlainObject(threshold)) {
    return {
      type: null,
      soft_quantile: null,
      hard_quantile: null,
      soft_threshold: null,
      hard_threshold: null,
    };
  }

  // New format: threshold.strategy is a string, threshold.soft/hard are numbers
  // Old format: threshold.strategy is an object with type, soft_quantile, etc.
  const strategy = threshold.strategy;
  const isNewFormat = typeof strategy === 'string';
  
  if (isNewFormat) {
    // New format: threshold = { strategy: "quantile_based", soft: <num>, hard: <num> }
    return {
      type: strategy,
      soft_quantile: null, // Not available in new format
      hard_quantile: null, // Not available in new format
      soft_threshold: isFiniteNumber(threshold.soft) ? threshold.soft : null,
      hard_threshold: isFiniteNumber(threshold.hard) ? threshold.hard : null,
    };
  } else if (isPlainObject(strategy)) {
    // Old format: threshold.strategy = { type, soft_quantile, hard_quantile, soft_threshold, threshold }
    return {
      type: typeof strategy.type === 'string' ? strategy.type : null,
      soft_quantile: isFiniteNumber(strategy.soft_quantile) ? strategy.soft_quantile : null,
      hard_quantile: isFiniteNumber(strategy.hard_quantile) ? strategy.hard_quantile : null,
      soft_threshold: isFiniteNumber(strategy.soft_threshold) ? strategy.soft_threshold : null,
      hard_threshold: isFiniteNumber(strategy.threshold) ? strategy.threshold : null,
    };
  }

  return {
    type: null,
    soft_quantile: null,
    hard_quantile: null,
    soft_threshold: null,
    hard_threshold: null,
  };
};

export const modelUI = {
  async load() {
    const modelCard = document.getElementById('modelCard');
    if (!modelCard) return;

    modelCard.innerHTML = `
      <div class="flex items-center justify-center p-8">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span class="ml-3 text-gray-600">Loading model metadata...</span>
      </div>
    `;

    try {
      const response = await api.model.info();

      if (!response || response.data === null) {
        this.renderEmpty();
        return;
      }

      const model = response.data || {};
      
      // Try to load feature_list.json if not in response
      // NEW format: feature_list may be included in metadata or fetched separately
      // OLD format: feature_list not available
      if (!Array.isArray(model.feature_list) && model.model_version) {
        // Attempt to fetch feature_list.json (non-blocking, optional)
        // Note: This requires backend to expose feature_list.json endpoint
        // For now, feature_list will be null and UI will show note
        try {
          // Try fetching from model artifacts if endpoint exists
          const featureListResponse = await fetch(`/api/model/artifacts/feature_list?version=${encodeURIComponent(model.model_version)}`);
          if (featureListResponse.ok) {
            const featureListData = await featureListResponse.json();
            if (featureListData.success && Array.isArray(featureListData.data)) {
              model.feature_list = featureListData.data;
            }
          }
        } catch (err) {
          // Silently fail - feature_list is optional, UI will show note
        }
      }
      
      this.render(model);
    } catch (error) {
      this.renderError(error.message || 'Failed to fetch model metadata');
    }
  },

  render(model) {
    const modelVersion = typeof model.model_version === 'string' ? model.model_version : null;
    const modelName = typeof model.model_name === 'string' ? model.model_name : null;
    const algorithm = typeof model.algorithm === 'string' ? model.algorithm : null;
    const modelType = typeof model.model_type === 'string' ? model.model_type : null;
    const trainedAt = model.trained_at ?? null;
    const featureCount = isFiniteNumber(model.feature_count) ? model.feature_count : null;
    const scalerUsed = model.scaler_used === true ? 'Yes' : (model.scaler_used === false ? 'No' : null);
    const scalerType = typeof model.scaler_type === 'string' ? model.scaler_type : null;

    const trainingRows = isFiniteNumber(model.training_rows) ? model.training_rows : null;
    const datasetSource = typeof model.dataset_source === 'string' ? model.dataset_source : null;
    const normalDefinition = isPlainObject(model?.filtering?.normal_definition)
      ? model.filtering.normal_definition
      : null;

    const thresholdStrategy = extractThresholdStrategy(model);

    const interpretation = isPlainObject(model?.interpretation) ? model.interpretation : null;
    const anomalyScoreIsProbability = interpretation ? formatBool(interpretation.anomaly_score_is_probability) : null;
    const anomalyScoreDefinition =
      interpretation && typeof interpretation.anomaly_score_definition === 'string'
        ? interpretation.anomaly_score_definition
        : null;
    const higherScoreMeans =
      interpretation && typeof interpretation.higher_score_means === 'string'
        ? interpretation.higher_score_means
        : null;

    const percentiles = isPlainObject(model?.score_percentiles) ? model.score_percentiles : null;
    const statistics = isPlainObject(model?.score_statistics) ? model.score_statistics : null;
    const featureList = Array.isArray(model?.feature_list) ? model.feature_list : null;

    const modelCard = document.getElementById('modelCard');
    if (!modelCard) return;

    const anomalyScoreProbabilityText =
      anomalyScoreIsProbability === 'no'
        ? 'no (not a probability)'
        : anomalyScoreIsProbability === 'yes'
          ? 'yes'
          : null;

    modelCard.innerHTML = `
      <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div class="mb-6">
          <h2 class="text-2xl font-bold mb-2 text-gray-900">Model Identity</h2>
          <p class="text-sm text-gray-500">Read-only model information</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          ${this.renderField('Model Version', modelVersion)}
          ${this.renderField('Model Name', modelName)}
          ${this.renderField('Algorithm', algorithm)}
          ${this.renderField('Model Type', modelType)}
          ${this.renderField('Trained At', safeFormatDate(trainedAt))}
          ${this.renderField('Feature Count', isFiniteNumber(featureCount) ? String(featureCount) : null)}
          ${scalerUsed ? this.renderField('Scaler Used', scalerUsed) : ''}
          ${scalerType ? this.renderField('Scaler Type', scalerType) : ''}
        </div>

        <div class="mt-6 pt-6 border-t border-gray-200">
          <h3 class="text-lg font-semibold mb-3 text-gray-900">Training Definition</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            ${this.renderField('Training Rows', isFiniteNumber(trainingRows) ? String(trainingRows) : null)}
            ${this.renderField('Dataset Source', datasetSource)}
          </div>
          ${normalDefinition ? `
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div class="text-sm font-semibold text-gray-900 mb-2">Normal Window Definition</div>
            ${this.renderRulesTable(normalDefinition)}
          </div>
          ` : datasetSource ? `
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div class="text-sm font-semibold text-gray-900 mb-2">Training Method</div>
            <div class="text-sm text-gray-700">Dataset-based training: Normal samples (is_anomaly == 0)</div>
          </div>
          ` : ''}
        </div>

        <div class="mt-6 pt-6 border-t border-gray-200">
          <h3 class="text-lg font-semibold mb-3 text-gray-900">Threshold Strategy</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${this.renderField('Strategy Type', thresholdStrategy.type)}
            ${thresholdStrategy.soft_quantile !== null ? this.renderField('Soft Quantile', formatNumber(thresholdStrategy.soft_quantile, 6)) : ''}
            ${thresholdStrategy.hard_quantile !== null ? this.renderField('Hard Quantile', formatNumber(thresholdStrategy.hard_quantile, 6)) : ''}
            ${thresholdStrategy.soft_threshold !== null ? this.renderField('Soft Threshold', formatNumber(thresholdStrategy.soft_threshold, 10)) : ''}
            ${thresholdStrategy.hard_threshold !== null ? this.renderField('Hard Threshold', formatNumber(thresholdStrategy.hard_threshold, 10)) : ''}
          </div>
        </div>

        <div class="mt-6 pt-6 border-t border-gray-200">
          <h3 class="text-lg font-semibold mb-3 text-gray-900">Anomaly Score Semantics</h3>
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-700 space-y-2">
            ${(() => {
              // NEW format (isolation_forest): Always show default semantics if no explicit metadata
              // OLD format: Use metadata if available, otherwise show defaults
              const isIsolationForest = algorithm === 'isolation_forest';
              const hasExplicitSemantics = anomalyScoreProbabilityText !== null || anomalyScoreDefinition || higherScoreMeans;
              
              if (hasExplicitSemantics) {
                // Use metadata-provided semantics
                return `
                  ${anomalyScoreProbabilityText !== null ? `<div><b>anomaly_score is probability:</b> ${anomalyScoreProbabilityText}</div>` : ''}
                  ${anomalyScoreDefinition ? `<div><b>anomaly_score definition:</b> ${anomalyScoreDefinition}</div>` : ''}
                  ${higherScoreMeans ? `<div><b>higher score means:</b> ${higherScoreMeans}</div>` : ''}
                `;
              } else {
                // Default semantics for isolation_forest (never show N/A)
                return `
                  <div class="text-gray-600 italic">anomaly_score is NOT a probability</div>
                  <div><b>anomaly_score definition:</b> anomaly_score = -decision_function(X)</div>
                  <div><b>higher score means:</b> Higher score means more abnormal (early warning signal)</div>
                `;
              }
            })()}
          </div>
        </div>

        <div class="mt-6 pt-6 border-t border-gray-200">
          <h3 class="text-lg font-semibold mb-3 text-gray-900">Score Distribution</h3>
          <div class="text-xs text-gray-500 mb-2">Statistics computed from training (normal) score distribution only</div>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            ${(() => {
              // NEW format: Prefer p98/p99, fallback to p90/p95 only if p98/p99 don't exist
              const hasNewFormat = percentiles?.p98 !== undefined || percentiles?.p99 !== undefined;
              if (hasNewFormat) {
                return `
                  ${percentiles?.p98 !== undefined ? this.renderField('p98', formatNumber(percentiles.p98, 10)) : ''}
                  ${percentiles?.p99 !== undefined ? this.renderField('p99', formatNumber(percentiles.p99, 10)) : ''}
                `;
              } else {
                // OLD format: Show p90/p95
                return `
                  ${percentiles?.p90 !== undefined ? this.renderField('p90', formatNumber(percentiles.p90, 10)) : ''}
                  ${percentiles?.p95 !== undefined ? this.renderField('p95', formatNumber(percentiles.p95, 10)) : ''}
                `;
              }
            })()}
          </div>
          ${statistics && (statistics.min !== undefined || statistics.max !== undefined || statistics.mean !== undefined || statistics.std !== undefined) ? `
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${statistics.min !== undefined ? this.renderField('min', formatNumber(statistics.min, 10)) : ''}
            ${statistics.max !== undefined ? this.renderField('max', formatNumber(statistics.max, 10)) : ''}
            ${statistics.mean !== undefined ? this.renderField('mean', formatNumber(statistics.mean, 10)) : ''}
            ${statistics.std !== undefined ? this.renderField('std', formatNumber(statistics.std, 10)) : ''}
          </div>
          ` : ''}
        </div>

        <div class="mt-6 pt-6 border-t border-gray-200">
          <h3 class="text-lg font-semibold mb-3 text-gray-900">Feature Information</h3>
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
            <div class="text-sm font-semibold text-gray-900 mb-2">Feature Count</div>
            <div class="text-sm text-gray-700">${isFiniteNumber(featureCount) ? `${featureCount} features` : 'N/A'}</div>
          </div>
          ${featureList && featureList.length > 0 ? `
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div class="text-sm font-semibold text-gray-900 mb-3">Feature List (${featureList.length})</div>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 text-xs font-mono text-gray-700">
              ${featureList.map(feature => `<div class="px-2 py-1 bg-white rounded border border-gray-200">${feature}</div>`).join('')}
            </div>
          </div>
          ` : isFiniteNumber(featureCount) ? `
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div class="text-xs text-gray-500">Feature list available in feature_list.json (not loaded in response)</div>
          </div>
          ` : ''}
        </div>
      </div>
    `;
  },

  renderEmpty() {
    const modelCard = document.getElementById('modelCard');
    if (!modelCard) return;

    modelCard.innerHTML = `
      <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div class="text-center py-8">
          <p class="text-gray-500 text-lg">Model metadata not available</p>
          <p class="text-gray-400 text-sm mt-2">The backend may be unavailable</p>
        </div>
      </div>
    `;
  },

  renderError(errorMessage) {
    const modelCard = document.getElementById('modelCard');
    if (!modelCard) return;

    modelCard.innerHTML = `
      <div class="bg-white rounded-xl shadow-sm border border-red-200 p-6">
        <div class="text-center py-8">
          <p class="text-red-600 text-lg font-semibold">Error</p>
          <p class="text-red-500 text-sm mt-2">${errorMessage}</p>
        </div>
      </div>
    `;
  },

  renderField(label, value) {
    const displayValue = value !== null && value !== undefined ? value : 'N/A';
    const textColor = value !== null && value !== undefined ? 'text-gray-900' : 'text-gray-400';

    return `
      <div class="bg-gray-50 rounded-lg p-4 border border-gray-200">
        <div class="text-xs text-gray-600 mb-1">${label}</div>
        <div class="text-lg font-semibold ${textColor}">${displayValue}</div>
      </div>
    `;
  },

  renderRulesTable(rules) {
    if (!rules || typeof rules !== 'object') {
      return '<div class="text-sm text-gray-400">N/A</div>';
    }

    const entries = Object.entries(rules).filter(([k]) => typeof k === 'string' && k.trim().length > 0);
    if (entries.length === 0) {
      return '<div class="text-sm text-gray-400">N/A</div>';
    }

    return `
      <div class="overflow-x-auto border border-gray-200 rounded-lg bg-white">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Rule</th>
              <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Condition</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            ${entries
              .map(([key, value]) => `
                <tr>
                  <td class="px-4 py-2 text-sm text-gray-900 font-medium">${key}</td>
                  <td class="px-4 py-2 text-sm text-gray-700 font-mono">${value !== null && value !== undefined ? String(value) : 'N/A'}</td>
                </tr>
              `)
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  startAutoRefresh(intervalMs = 30000) {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
    refreshInterval = setInterval(() => {
      this.load();
    }, intervalMs);
  },

  stopAutoRefresh() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  },
};
