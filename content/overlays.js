const overlays = [];
const openOrder = [];

export function register(name, api, opts = {}) {
  overlays.push({ name, modal: opts.modal !== false, ...api });
}

export function touch(name) {
  const idx = openOrder.indexOf(name);
  if (idx >= 0) openOrder.splice(idx, 1);
  openOrder.push(name);
}

function byName(name) {
  return overlays.find((overlay) => overlay.name === name);
}

export const Overlays = {

  closeAll() {
    const seen = new Set();
    for (let i = openOrder.length - 1; i >= 0; i--) {
      const overlay = byName(openOrder[i]);
      if (overlay && !seen.has(overlay.name) && overlay.isActive()) {
        seen.add(overlay.name);
        overlay.close();
      }
    }
    for (const overlay of overlays) {
      if (!seen.has(overlay.name) && overlay.isActive()) overlay.close();
    }
    openOrder.length = 0;
  },

  active() {
    for (let i = openOrder.length - 1; i >= 0; i--) {
      const overlay = byName(openOrder[i]);
      if (overlay && overlay.modal && overlay.isActive()) return overlay;
    }
    return overlays.find((overlay) => overlay.modal && overlay.isActive()) || null;
  },
};
