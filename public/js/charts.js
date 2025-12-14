let chartInstances = {};

export const charts = {
  create(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;

    if (chartInstances[id]) {
      chartInstances[id].destroy();
    }

    const ctx = canvas.getContext('2d');
    chartInstances[id] = new Chart(ctx, config);
    return chartInstances[id];
  },

  update(id, data) {
    if (chartInstances[id]) {
      chartInstances[id].data = data;
      chartInstances[id].update();
    }
  },

  destroy(id) {
    if (chartInstances[id]) {
      chartInstances[id].destroy();
      delete chartInstances[id];
    }
  },

  destroyAll() {
    Object.keys(chartInstances).forEach(id => {
      charts.destroy(id);
    });
  },

  getInstance(id) {
    return chartInstances[id] || null;
  },
};

