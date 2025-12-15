import { api } from './api.js';
import { ui } from './ui.js';

let refreshInterval = null;

// NOTE: Model metadata is provided by the ML pipeline via the inference service.
// The frontend does NOT calculate or compute any model metrics.
// All data comes from GET /api/model/info endpoint.
export const modelUI = {
  async load() {
    // Show loading state
    document.getElementById('modelCard').innerHTML = `
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
    // NOTE: This UI strictly mirrors inference metadata from the backend.
    // Backend GET /api/model/info returns: { version, train_date, window_minutes, feature_count, threshold, feature_importance }
    // All field extraction must match backend keys exactly - no fallbacks or computed values.

    // Extract required fields with safe defaults (matching backend keys exactly)
    const modelVersion = model.version || null;
    const trainDate = model.train_date || null;
    const trainWindow = model.window_minutes || null;
    const featureCount = model.feature_count !== undefined ? model.feature_count : null;
    const threshold = model.threshold !== undefined ? model.threshold : null;

    // Get top 5 features from feature_importance array
    const featureImportance = model.feature_importance || [];
    const topFeatures = Array.isArray(featureImportance) 
      ? featureImportance.slice(0, 5).map(f => typeof f === 'string' ? f : (f.name || f))
      : [];

    document.getElementById('modelCard').innerHTML = `
      <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div class="mb-6">
          <h2 class="text-2xl font-bold mb-2 text-gray-900">Model Metadata</h2>
          <p class="text-sm text-gray-500">Metadata provided by ML pipeline</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          ${this.renderField('Model Version', modelVersion)}
          ${this.renderField('Training Date', trainDate ? ui.formatDate(trainDate) : null)}
          ${this.renderField('Training Window', trainWindow !== null ? `${trainWindow} minutes` : null)}
          ${this.renderField('Feature Count', featureCount !== null ? featureCount.toString() : null)}
          ${this.renderField('Threshold', threshold !== null ? threshold.toString() : null)}
        </div>

        <div class="mt-6 pt-6 border-t border-gray-200">
          <h3 class="text-lg font-semibold mb-3 text-gray-900">Top Features</h3>
          ${this.renderTopFeatures(topFeatures)}
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

  renderTopFeatures(features) {
    // Show top 5 features from feature_importance array
    // If empty or missing, show "Not available"
    if (!features || features.length === 0) {
      return '<p class="text-gray-400 text-sm">Not available</p>';
    }

    return `
      <ul class="space-y-2">
        ${features.map((feature, index) => {
          const featureName = typeof feature === 'string' ? feature : (feature.name || feature);
          const importance = typeof feature === 'object' && feature.importance !== undefined 
            ? ` (${feature.importance.toFixed(4)})` 
            : '';
          return `
            <li class="text-gray-900">
              <span class="text-gray-500">${index + 1}.</span> 
              <span class="font-medium">${featureName}</span>
              ${importance ? `<span class="text-gray-400 text-sm">${importance}</span>` : ''}
            </li>
          `;
        }).join('')}
      </ul>
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

