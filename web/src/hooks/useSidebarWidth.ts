import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "pi-sidebar-width";
const DEFAULT = 280;
const MIN = 220;
const MAX = 480;

function clamp(value: number): number {
  return Math.min(MAX, Math.max(MIN, value));
}

function readStored(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return clamp(parsed);
    }
  } catch {
    /* ignore */
  }
  return DEFAULT;
}

export function useSidebarWidth(enabled: boolean) {
  const [width, setWidth] = useState(readStored);

  useEffect(() => {
    if (!enabled) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
      /* ignore */
    }
  }, [width, enabled]);

  const onResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;

      const onMove = (moveEvent: PointerEvent) => {
        setWidth(clamp(startWidth + moveEvent.clientX - startX));
      };

      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [width],
  );

  const resetWidth = useCallback(() => setWidth(DEFAULT), []);

  return { width, onResizePointerDown, resetWidth };
}
