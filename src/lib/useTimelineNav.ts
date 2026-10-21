import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Timeline navigation: drag with the mouse to pan, Ctrl/Cmd + wheel to zoom around
 * the cursor. A drag doesn't count as a click, so clicking a bar still selects it.
 */
export function useTimelineNav(
  scroller: RefObject<HTMLDivElement | null>,
  pxPerSec: number,
  setPx: (n: number) => void,
  min: number,
  max: number,
) {
  const px = useRef(pxPerSec);
  px.current = pxPerSec;
  /** keep the time under the cursor in place after a zoom */
  const anchor = useRef<{ sec: number; offset: number } | null>(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && anchor.current) {
      el.scrollLeft = anchor.current.sec * pxPerSec - anchor.current.offset;
      anchor.current = null;
    }
  }, [pxPerSec, scroller]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let down = false;
    let moved = false;
    let startX = 0;
    let startLeft = 0;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      down = true;
      moved = false;
      startX = e.clientX;
      startLeft = el.scrollLeft;
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 4) {
        moved = true;
        el.classList.add('panning');
      }
      if (moved) el.scrollLeft = startLeft - dx;
    };
    const onUp = () => {
      down = false;
      el.classList.remove('panning');
    };
    // swallow the click that ends a drag
    const onClick = (e: MouseEvent) => {
      if (moved) {
        e.stopPropagation();
        e.preventDefault();
        moved = false;
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const offset = e.clientX - rect.left;
      const cur = px.current;
      const next = Math.min(max, Math.max(min, cur * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      if (next === cur) return;
      anchor.current = { sec: (offset + el.scrollLeft) / cur, offset };
      setPx(Math.round(next * 10) / 10);
    };

    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('click', onClick, true);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('wheel', onWheel);
    };
  }, [scroller, setPx, min, max]);

  /** zoom so `totalSec` fits the visible width */
  return (totalSec: number) => {
    const el = scroller.current;
    if (!el || totalSec <= 0) return;
    setPx(Math.min(max, Math.max(min, Math.floor(((el.clientWidth - 8) / totalSec) * 10) / 10)));
    el.scrollLeft = 0;
  };
}
