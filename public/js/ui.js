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
    // Soft, academic-friendly color scheme - text only, no icons
    const statusLower = status?.toLowerCase() || 'unknown';
    
    // Normal / Active / Success → light green
    if (['online', 'active', 'normal', 'success', 'completed'].includes(statusLower)) {
      return 'bg-green-100 text-green-800';
    }
    
    // Pending / Updating → light blue
    if (['pending', 'updating'].includes(statusLower)) {
      return 'bg-blue-100 text-blue-800';
    }
    
    // Warning → light yellow
    if (['warning', 'warn'].includes(statusLower)) {
      return 'bg-yellow-100 text-yellow-800';
    }
    
    // Failed / Error / Anomaly → light red
    if (['failed', 'error', 'anomaly', 'offline'].includes(statusLower)) {
      return 'bg-red-100 text-red-800';
    }
    
    // Unknown / N/A → light gray
    return 'bg-gray-100 text-gray-800';
  },

  getOTAStatusColor(otaStatus) {
    // Soft, academic-friendly color scheme for OTA status
    if (!otaStatus) return 'bg-gray-100 text-gray-800';
    
    const status = otaStatus.toLowerCase();
    
    // Success / Completed / Idle → light green
    if (['completed', 'success', 'idle'].includes(status)) {
      return 'bg-green-100 text-green-800';
    }
    
    // Pending / Updating → light blue
    if (['pending', 'updating'].includes(status)) {
      return 'bg-blue-100 text-blue-800';
    }
    
    // Failed / Error → light red
    if (['failed', 'error'].includes(status)) {
      return 'bg-red-100 text-red-800';
    }
    
    // Unknown / N/A → light gray
    return 'bg-gray-100 text-gray-800';
  },
};

