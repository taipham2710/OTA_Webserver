export const ui = {
  showLoading(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
      el.innerHTML = '<div class="flex items-center justify-center p-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div></div>';
    }
  },

  showError(elementId, message) {
    const el = document.getElementById(elementId);
    if (el) {
      el.innerHTML = `<div class="p-4 bg-red-50 border border-red-200 rounded text-red-700">${message}</div>`;
    }
  },

  formatDate(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  },

  formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  },

  getStatusColor(status) {
    const colors = {
      online: 'bg-green-500',
      offline: 'bg-gray-500',
      error: 'bg-red-500',
      warning: 'bg-yellow-500',
      pending: 'bg-blue-500',
    };
    return colors[status?.toLowerCase()] || 'bg-gray-500';
  },

  getOTAStatusColor(otaStatus) {
    if (!otaStatus) return 'bg-gray-400 text-gray-700';
    const status = otaStatus.toLowerCase();
    if (status === 'pending') return 'bg-yellow-400 text-yellow-900';
    if (status === 'failed') return 'bg-red-500 text-white';
    if (status === 'completed') return 'bg-green-500 text-white';
    return 'bg-gray-400 text-gray-700';
  },
};

