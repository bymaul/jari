// Jari: registry of modal overlays (help, hints, prompt).
// The dispatcher asks the registry which overlay is active instead of
// hardcoding each one, and entering ignore/passthrough or disabling Jari
// closes every overlay through closeAll. Each overlay self-registers with its
// public close/onKeyDown/isActive API. Only one overlay can own the keys at a
// time (the dispatcher routes to the first active one), so registration order
// is the fallback priority if that invariant ever breaks.

const overlays = []; // { name, close, onKeyDown, isActive }

export function register(name, api) {
  overlays.push({ name, ...api });
}

export const Overlays = {
  // Close every active overlay. Idempotent: each overlay's close() already
  // no-ops when it is not open.
  closeAll() {
    for (const overlay of overlays) {
      if (overlay.isActive()) overlay.close();
    }
  },

  // The overlay currently owning the keys, or null.
  active() {
    return overlays.find((overlay) => overlay.isActive()) || null;
  },
};
