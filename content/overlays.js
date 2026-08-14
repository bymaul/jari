const overlays = [];

export function register(name, api) {
  overlays.push({ name, ...api });
}

export const Overlays = {

  closeAll() {
    for (const overlay of overlays) {
      if (overlay.isActive()) overlay.close();
    }
  },

  active() {
    return overlays.find((overlay) => overlay.isActive()) || null;
  },
};
