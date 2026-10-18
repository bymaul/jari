/** Overlay contract: each open-mode (hints, find, omnibar, ...) registers a
 *  name and api; consumers register overlays from JS modules still. */
export interface OverlayApi {
  name: string;
  modal: boolean;
  isActive(): boolean;
  close(): void;
  onKeyDown?(event: KeyboardEvent): boolean | void;
  onKeyUp?(event: KeyboardEvent): boolean | void;
}

const overlays: OverlayApi[] = [];
const openOrder: string[] = [];

export function register(
  name: string,
  api: Partial<OverlayApi>,
  { modal = true } = {},
): void {
  overlays.push({
    name,
    modal,
    ...(api as Omit<OverlayApi, "name" | "modal">),
  });
}

export function touch(name: string): void {
  const idx = openOrder.indexOf(name);
  if (idx >= 0) openOrder.splice(idx, 1);
  openOrder.push(name);
}

function byName(name: string): OverlayApi | undefined {
  return overlays.find((overlay) => overlay.name === name);
}

export const Overlays = {
  closeAll(): void {
    const seen = new Set<string>();
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

  active(): OverlayApi | null {
    for (let i = openOrder.length - 1; i >= 0; i--) {
      const overlay = byName(openOrder[i]);
      if (overlay && overlay.modal && overlay.isActive()) return overlay;
    }
    return (
      overlays.find((overlay) => overlay.modal && overlay.isActive()) || null
    );
  },
};
