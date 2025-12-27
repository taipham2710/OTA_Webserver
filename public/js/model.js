import { api } from './api.js';
import { ui } from './ui.js';

let refreshInterval = null;

// NOTE: Read-only operational UI.
// - Does not compute/infer anomaly/drift/threshold policy.
// - Renders only fields returned by GET /api/model/info.
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
      
      // Handle null data (inference service unavailable)
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
    const modelVersion = model.model_version ?? null;
    const trainedAt = model.trained_at ?? null;
    const trainingWindow = model.training_window ?? null;
    const featureCount = model.feature_count ?? null;
    const hardThreshold = model.threshold?.value ?? null;
    const softThreshold = model.threshold?.soft_value ?? null;

    const modelName = model.model_name ?? null;
    const algorithm = model.algorithm ?? null;
    const trainRows = model.data?.train_rows ?? null;
    const holdoutRows = model.data?.holdout_rows ?? null;

    const holdout = model.metrics?.holdout ?? null;
    const precision = holdout?.precision ?? null;
    const recall = holdout?.recall ?? null;
    const f1 = holdout?.f1 ?? null;
    const rocAuc = holdout?.roc_auc ?? null;
    const prAuc = holdout?.pr_auc ?? null;

    const featureImportance = Array.isArray(model.feature_importance)
      ? model.feature_importance
      : [];

    const topFeatures = featureImportance
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({ name: item.name ?? null, importance: item.importance ?? null }))
      .filter(
        (item) =>
          typeof item.name === 'string' &&
          typeof item.importance === 'number' &&
          !Number.isNaN(item.importance),
      )
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 15);

    const modelCard = document.getElementById('modelCard');
    if (!modelCard) return;

    modelCard.innerHTML = `
      <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div class="mb-6">
          <h2 class="text-2xl font-bold mb-2 text-gray-900">Model Metadata</h2>
          <p class="text-sm text-gray-500">Metadata provided by backend</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          ${this.renderField('Model Version', modelVersion)}
          ${this.renderField('Training Date', trainedAt ? ui.formatDate(trainedAt) : null)}
          ${this.renderField('Training Window', trainingWindow !== null && trainingWindow !== undefined ? String(trainingWindow) : null)}
          ${this.renderField('Feature Count', typeof featureCount === 'number' ? String(featureCount) : null)}
          ${this.renderField('Hard Threshold', typeof hardThreshold === 'number' ? hardThreshold.toFixed(4) : null)}
          ${this.renderField('Soft Threshold', typeof softThreshold === 'number' ? softThreshold.toFixed(4) : null)}
        </div>

        <div class="mt-6 pt-6 border-t border-gray-200">
          <h3 class="text-lg font-semibold mb-3 text-gray-900">Training Metadata</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${this.renderField('Model Name', modelName)}
            ${this.renderField('Algorithm', algorithm)}
            ${this.renderField('Train Rows', typeof trainRows === 'number' ? String(trainRows) : null)}
            ${this.renderField('Holdout Rows', typeof holdoutRows === 'number' ? String(holdoutRows) : null)}
          </div>
        </div>

        <div class="mt-6 pt-6 border-t border-gray-200">
          <h3 class="text-lg font-semibold mb-3 text-gray-900">Evaluation Metrics (Holdout)</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${this.renderField('Precision', typeof precision === 'number' ? precision.toFixed(4) : null)}
            ${this.renderField('Recall', typeof recall === 'number' ? recall.toFixed(4) : null)}
            ${this.renderField('F1-score', typeof f1 === 'number' ? f1.toFixed(4) : null)}
            ${this.renderField('ROC-AUC', typeof rocAuc === 'number' ? rocAuc.toFixed(4) : null)}
            ${this.renderField('PR-AUC', typeof prAuc === 'number' ? prAuc.toFixed(4) : null)}
          </div>
        </div>

        <div class="mt-6 pt-6 border-t border-gray-200">
          <h3 class="text-lg font-semibold mb-3 text-gray-900">Top Feature Importance</h3>
          ${this.renderFeatureImportanceTable(topFeatures)}
        </div>
      </div>
    `;
  },

  renderEmpty() {
    document.getElementById('modelCard').innerHTML = `
      <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div class="text-center py-8">
          <p class="text-gray-500 text-lg">Model metadata not available</p>
          <p class="text-gray-400 text-sm mt-2">The inference service may be unavailable</p>
        </div>
      </div>
    `;
  },

  renderError(errorMessage) {
    document.getElementById('modelCard').innerHTML = `
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

  renderFeatureImportanceTable(features) {
    if (!features || features.length === 0) {
      return '<p class="text-gray-400 text-sm">Feature importance not available</p>';
    }

    return `
      <div class="overflow-x-auto border border-gray-200 rounded-lg">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Rank</th>
              <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Feature Name</th>
              <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Importance</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${features.map((feature, index) => `
              <tr>
                <td class="px-4 py-2 text-sm text-gray-600">${index + 1}</td>
                <td class="px-4 py-2 text-sm text-gray-900 font-medium">${feature.name}</td>
                <td class="px-4 py-2 text-sm text-gray-700 font-mono">${feature.importance.toFixed(4)}</td>
              </tr>
            `).join('')}
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
