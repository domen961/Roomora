import { forwardRef } from "react";

/**
 * Off-screen canvas for Babylon.js — must be in the DOM with real dimensions
 * for WebGL to work, but positioned out of view so the merchant never sees it.
 */
const HiddenCanvas = forwardRef<HTMLCanvasElement>((_, ref) => (
  <canvas
    ref={ref}
    style={{
      position: "fixed",
      left: "-2200px",
      top: 0,
      width: "1024px",
      height: "1024px",
      pointerEvents: "none",
    }}
    aria-hidden="true"
  />
));
HiddenCanvas.displayName = "HiddenCanvas";

export default HiddenCanvas;
