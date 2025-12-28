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
  const strategy = model?.threshold?.strategy;
  if (!isPlainObject(strategy)) {
    return {
      type: null,
      soft_quantile: null,
      hard_quantile: null,
      soft_threshold: null,
      threshold: null,
    };
  }

  return {
    type: typeof strategy.type === 'string' ? strategy.type : null,
    soft_quantile: isFiniteNumber(strategy.soft_quantile) ? strategy.soft_quantile : null,
    hard_quantile: isFiniteNumber(strategy.hard_quantile) ? strategy.hard_quantile : null,
    soft_threshold: isFiniteNumber(strategy.soft_threshold) ? strategy.soft_threshold : null,
    threshold: isFiniteNumber(strategy.threshold) ? strategy.threshold : null,
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

    const trainingRows = isFiniteNumber(model.training_rows) ? model.training_rows : null;
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
        </div>

        <div class="mt-6 pt-6 border-t border-gray-200">
          <h3 class="text-lg font-semibold mb-3 text-gray-900">Training Definition</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            ${this.renderField('Training Rows', isFiniteNumber(trainingRows) ? String(trainingRows) : null)}
          </div>
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div class="text-sm font-semibold text-gray-900 mb-2">Normal Window Definition</div>
            ${this.renderRulesTable(normalDefinition)}
          </div>
        </div>

        <div class="mt-6 pt-6 border-t border-gray-200">
          <h3 class="text-lg font-semibold mb-3 text-gray-900">Threshold Strategy</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${this.renderField('Strategy Type', thresholdStrategy.type)}
            ${this.renderField('Soft Quantile', formatNumber(thresholdStrategy.soft_quantile, 6))}
            ${this.renderField('Hard Quantile', formatNumber(thresholdStrategy.hard_quantile, 6))}
            ${this.renderField('Soft Threshold', formatNumber(thresholdStrategy.soft_threshold, 10))}
            ${this.renderField('Threshold', formatNumber(thresholdStrategy.threshold, 10))}
          </div>
        </div>

        <div class="mt-6 pt-6 border-t border-gray-200">
          <h3 class="text-lg font-semibold mb-3 text-gray-900">Anomaly Score Semantics</h3>
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-700 space-y-2">
            <div><b>anomaly_score is probability:</b> ${anomalyScoreProbabilityText ?? 'N/A'}</div>
            <div><b>anomaly_score definition:</b> ${anomalyScoreDefinition ?? 'N/A'}</div>
            <div><b>higher score means:</b> ${higherScoreMeans ?? 'N/A'}</div>
          </div>
        </div>

        <div class="mt-6 pt-6 border-t border-gray-200">
          <h3 class="text-lg font-semibold mb-3 text-gray-900">Score Distribution</h3>
          <div class="text-xs text-gray-500 mb-2">Statistics computed from training (normal) score distribution only</div>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            ${this.renderField('p90', formatNumber(percentiles?.p90, 10))}
            ${this.renderField('p95', formatNumber(percentiles?.p95, 10))}
            ${this.renderField('p99', formatNumber(percentiles?.p99, 10))}
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${this.renderField('min', formatNumber(statistics?.min, 10))}
            ${this.renderField('max', formatNumber(statistics?.max, 10))}
            ${this.renderField('mean', formatNumber(statistics?.mean, 10))}
            ${this.renderField('std', formatNumber(statistics?.std, 10))}
          </div>
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
