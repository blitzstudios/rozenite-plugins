import { ATTACH_HEARTBEAT_MS, ATTACH_LEASE_MS } from './protocol';

/** A timer this late means the JS thread was stopped, which says nothing about the panels. */
const FROZEN_GAP_MS = 2 * ATTACH_HEARTBEAT_MS;

export type PanelLeases = {
  /** Renews `panelId`'s lease; true when it is a panel not seen before. */
  renew: (panelId: string) => boolean;
  release: (panelId: string) => void;
  releaseAll: () => void;
  attached: () => boolean;
};

/**
 * Which panels are attached, each until it stops renewing. Several DevTools windows can be open at once,
 * and the app counts as watched while any one of them is.
 */
export function createPanelLeases(onAttachedChange: (attached: boolean) => void): PanelLeases {
  const panels = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    onAttachedChange(false);
  };

  const release = (panelId: string) => {
    if (panels.delete(panelId) && panels.size === 0) stop();
  };

  const start = () => {
    let lastTick = Date.now();
    timer = setInterval(() => {
      const now = Date.now();
      const frozen = now - lastTick > FROZEN_GAP_MS;
      lastTick = now;
      panels.forEach((renewedAt, panelId) => {
        if (frozen) panels.set(panelId, now);
        else if (now - renewedAt > ATTACH_LEASE_MS) release(panelId);
      });
    }, ATTACH_HEARTBEAT_MS);
    onAttachedChange(true);
  };

  return {
    renew: (panelId) => {
      const isNew = !panels.has(panelId);
      panels.set(panelId, Date.now());
      if (isNew && panels.size === 1) start();
      return isNew;
    },
    release,
    releaseAll: () => {
      if (!panels.size) return;
      panels.clear();
      stop();
    },
    attached: () => panels.size > 0,
  };
}
