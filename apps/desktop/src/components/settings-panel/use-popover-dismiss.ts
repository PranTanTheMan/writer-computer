import { useEffect, useEffectEvent, type RefObject } from "react";

/** Dismiss a mounted popover on outside pointerdown, Escape, window resize,
 *  or wheel-scrolling outside it (a fixed-position popover doesn't track its
 *  anchor, so closing beats drifting away from it). Wheel rather than scroll:
 *  momentum scrolling keeps emitting scroll events after the gesture ends,
 *  which would instantly close a popover opened mid-glide. Events inside the
 *  popover or its anchor don't dismiss — the anchor's toggle stays in charge. */
export function usePopoverDismiss(
  popoverRef: RefObject<HTMLElement | null>,
  anchorRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
) {
  const dismiss = useEffectEvent(onDismiss);

  useEffect(() => {
    const isInside = (target: EventTarget | null) =>
      target instanceof Node &&
      (popoverRef.current?.contains(target) || anchorRef.current?.contains(target));

    const onPointerDown = (event: PointerEvent) => {
      if (!isInside(event.target)) dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    const onWheel = (event: Event) => {
      if (!isInside(event.target)) dismiss();
    };
    const onResize = () => dismiss();

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("wheel", onWheel, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("resize", onResize);
    };
  }, [popoverRef, anchorRef]);
}
