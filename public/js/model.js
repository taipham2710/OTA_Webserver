import { api } from './api.js';
import { charts } from './charts.js';
import { ui } from './ui.js';

let refreshInterval = null;

const tooltips = {
  f1: 'F1-score: Harmonic mean of precision and recall. Higher is better (0-1).',
  pr_auc: 'PR-AUC: Area under Precision-Recall curve. Higher is better (0-1).',
  roc_auc: 'ROC-AUC: Area under ROC curve. Higher is better (0-1).',
  holdout_f1: 'Holdout F1: F1-score on held-out test set. Measures generalization.',
  train_window_size: 'Training window size: Number of samples used for training.',
  drift_status: 'Drift status: Indicates if data distribution has shifted from training.',
};

export const modelUI = {
  async load() {
    try {
      const data = await api.model.info();
      const model = data.data || {};
      this.render(model);
    } catch (error) {
      document.getElementById('modelCard').innerHTML = 
        `<div class="p-4 bg-red-50 border border-red-200 rounded text-red-700">Error: ${error.message}</div>`;
    }
  },

  render(model) {
    // Support both old and new API format
    const modelVersion = model.model_version || model.version;
    const driftDetected = model.drift_detected !== undefined ? model.drift_detected : (model.drift_status === 'detected' || (model.drift_features && model.drift_features.length > 0));
    const topFeatures = model.top_features || model.features || [];
    const driftBorderClass = driftDetected ? 'border-red-500' : 'border-gray-200';

    document.getElementById('modelCard').innerHTML = `
      <div class="bg-white rounded-xl shadow-sm border ${driftBorderClass} p-6">
        <div class="flex justify-between items-start mb-6">
          <div>
            <h2 class="text-2xl font-bold mb-2 text-gray-900">Model Information</h2>
            ${driftDetected ? '<div class="text-sm text-red-600 font-semibold">⚠️ Data Drift Detected</div>' : ''}
          </div>
          <div class="text-sm text-gray-600" id="lastUpdate">Loading...</div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          ${this.renderMetricCard('Version', modelVersion || 'N/A', 'version')}
          ${this.renderMetricCard('Train Date', ui.formatDate(model.train_date), 'train_date')}
          ${this.renderMetricCard('Train Window Size', model.train_window_size ? model.train_window_size.toLocaleString() : 'N/A', 'train_window_size')}
          ${this.renderMetricCard('Drift Status', this.formatDriftStatus(driftDetected ? 'detected' : (model.drift_status || 'none')), 'drift_status', driftDetected)}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          ${this.renderMetricCard('F1-Score', this.formatMetric(model.f1), 'f1')}
          ${this.renderMetricCard('PR-AUC', this.formatMetric(model.pr_auc), 'pr_auc')}
          ${this.renderMetricCard('ROC-AUC', this.formatMetric(model.roc_auc), 'roc_auc')}
          ${this.renderMetricCard('Holdout F1', this.formatMetric(model.holdout_f1), 'holdout_f1')}
        </div>

        <div class="mb-6">
          <h3 class="text-lg font-semibold mb-3 text-gray-900">Drifted Features</h3>
          <div id="driftFeaturesList" class="flex flex-wrap gap-2">
            ${this.renderDriftFeatures(model.drift_features || [])}
          </div>
        </div>

        <div>
          <h3 class="text-lg font-semibold mb-3 text-gray-900">Feature Importance</h3>
          <div class="h-96">
            <canvas id="featureImportanceChart"></canvas>
          </div>
        </div>
      </div>
    `;

    this.renderFeatureChart(topFeatures);
    document.getElementById('lastUpdate').textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
  },

  renderMetricCard(label, value, metricKey, highlight = false) {
    const tooltip = tooltips[metricKey] || '';
    const highlightClass = highlight ? 'border-red-500 bg-red-50' : '';
    
    return `
      <div class="bg-white rounded-lg p-4 border border-gray-200 ${highlightClass} relative group">
        <div class="text-xs text-gray-600 mb-1 flex items-center">
          ${label}
          ${tooltip ? `<span class="ml-1 cursor-help">ℹ️</span>` : ''}
        </div>
        <div class="text-xl font-bold text-gray-900">${value}</div>
        ${tooltip ? `
          <div class="absolute left-0 top-full mt-2 w-64 p-2 bg-gray-900 text-white border border-gray-700 rounded text-xs opacity-0 group-hover:opacity-100 pointer-events-none z-10 transition-opacity">
            ${tooltip}
          </div>
        ` : ''}
      </div>
    `;
  },

  formatMetric(value) {
    if (value === null || value === undefined) return 'N/A';
    return value.toFixed(4);
  },

  formatDriftStatus(status) {
    const statusMap = {
      detected: '<span class="text-red-600 font-semibold">Detected</span>',
      none: '<span class="text-green-600">None</span>',
      unknown: '<span class="text-gray-500">Unknown</span>',
    };
    return statusMap[status] || status;
  },

  renderDriftFeatures(features) {
    if (features.length === 0) {
      return '<span class="text-gray-500 text-sm">No drift detected</span>';
    }
    return features.map(feature => 
      `<span class="px-3 py-1 bg-red-50 border border-red-500 rounded text-red-700 text-sm">${feature}</span>`
    ).join('');
  },

  renderFeatureChart(features) {
    if (!features || features.length === 0) {
      document.getElementById('featureImportanceChart').parentElement.innerHTML = 
        '<div class="text-gray-500 text-center py-8">No feature data available</div>';
      return;
    }

    const sortedFeatures = [...features].sort((a, b) => b.importance - a.importance).slice(0, 15);

    charts.destroy('featureImportanceChart');

    charts.create('featureImportanceChart', {
      type: 'bar',
      data: {
        labels: sortedFeatures.map(f => f.name),
        datasets: [{
          label: 'Importance',
          data: sortedFeatures.map(f => f.importance),
          backgroundColor: sortedFeatures.map((f, i) => {
            const hue = (i * 360 / sortedFeatures.length) % 360;
            return `hsla(${hue}, 70%, 50%, 0.7)`;
          }),
          borderColor: sortedFeatures.map((f, i) => {
            const hue = (i * 360 / sortedFeatures.length) % 360;
            return `hsl(${hue}, 70%, 50%)`;
          }),
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(17, 24, 39, 0.9)',
            titleColor: '#ffffff',
            bodyColor: '#ffffff',
            borderColor: '#6b7280',
            borderWidth: 1,
          },
        },
        scales: {
          x: {
            ticks: { color: '#6b7280' },
            grid: { color: '#e5e7eb' },
            beginAtZero: true,
          },
          y: {
            ticks: { color: '#6b7280' },
            grid: { color: '#e5e7eb' },
          },
        },
      },
    });
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

