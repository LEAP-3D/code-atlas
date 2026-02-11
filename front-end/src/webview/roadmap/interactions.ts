// User interactions: pan, zoom, drag

import * as state from "./state";
import { getElement } from "./utils";
import { closeFunctionPanel, updateBreadcrumb } from "./panel";

/**
 * Update graph transform (position and scale)
 */
export function updateTransform(): void {
  getElement<HTMLDivElement>("graphContainer").style.transform =
    `translate(calc(-50% + ${state.translateX}px), calc(-50% + ${state.translateY}px)) scale(${state.scale})`;
}

/**
 * Zoom in
 */
export function zoomIn(): void {
  setZoom(Math.min(state.scale + state.ZOOM_STEP, state.MAX_SCALE));
}

/**
 * Zoom out
 */
export function zoomOut(): void {
  setZoom(Math.max(state.scale - state.ZOOM_STEP, state.MIN_SCALE));
}

/**
 * Set zoom level
 */
export function setZoom(newScale: number): void {
  state.setScale(newScale);
  updateTransform();
  getElement<HTMLDivElement>("zoomLevel").textContent =
    `${Math.round(state.scale * 100)}%`;
}

/**
 * Reset view to show all nodes
 */
export function resetView(): void {
  state.setFocusedFile(null);

  if (state.allNodes.length > 0) {
    // Calculate bounds
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    state.allNodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    });

    const gw = maxX - minX + 200;
    const gh = maxY - minY + 200;
    const gcx = (minX + maxX) / 2;
    const gcy = (minY + maxY) / 2;

    const canvas = getElement<HTMLDivElement>("canvas");
    const rect = canvas.getBoundingClientRect();
    const ccx = rect.width / 2;
    const ccy = rect.height / 2;

    // Calculate optimal scale
    const newScale = Math.max(
      state.MIN_SCALE,
      Math.min((rect.width * 0.9) / gw, (rect.height * 0.9) / gh, 1),
    );

    state.setScale(newScale);
    state.setTranslate(
      ccx - (gcx - 5000) * newScale,
      ccy - (gcy - 5000) * newScale,
    );
  } else {
    state.setScale(0.5);
    state.setTranslate(0, 0);
  }

  // Reset node styles
  state.allNodes.forEach((n) =>
    n.element.classList.remove("focused", "dimmed", "small", "dependency"),
  );

  // Reset connection styles
  state.connections.forEach(({ line }) =>
    line.classList.remove("highlight", "dependency-line"),
  );

  updateTransform();
  getElement<HTMLDivElement>("zoomLevel").textContent =
    `${Math.round(state.scale * 100)}%`;
  updateBreadcrumb("Full Map");
  closeFunctionPanel();
}

/**
 * Setup canvas event listeners
 */
export function setupCanvasEvents(): void {
  const canvas = getElement<HTMLDivElement>("canvas");

  // Mouse down - start drag
  canvas.addEventListener("mousedown", (e) => {
    if (
      e.target === canvas ||
      (e.target as HTMLElement).closest("#graphContainer")
    ) {
      state.setDragging(true);
      state.setDragStart(
        e.clientX - state.translateX,
        e.clientY - state.translateY,
      );
      canvas.classList.add("grabbing");
    }
  });

  // Mouse move - drag
  canvas.addEventListener("mousemove", (e) => {
    if (state.isDragging) {
      state.setTranslate(e.clientX - state.startX, e.clientY - state.startY);
      updateTransform();
    }
  });

  // Mouse up - end drag
  canvas.addEventListener("mouseup", () => {
    state.setDragging(false);
    canvas.classList.remove("grabbing");
  });

  // Mouse leave - end drag
  canvas.addEventListener("mouseleave", () => {
    state.setDragging(false);
    canvas.classList.remove("grabbing");
  });

  // Wheel - zoom or pan
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (e.metaKey || e.ctrlKey) {
        // Zoom with Cmd/Ctrl + scroll
        e.preventDefault();

        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Account for the -50% offset in the transform
        // The graph container is centered at (rect.width/2, rect.height/2)
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        // Calculate the graph-space coordinates under the cursor
        const gx = (mx - centerX - state.translateX) / state.scale;
        const gy = (my - centerY - state.translateY) / state.scale;

        // Figma-style zoom: proportional to current scale for smooth feel
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.max(
          state.MIN_SCALE,
          Math.min(state.MAX_SCALE, state.scale * zoomFactor),
        );

        // Calculate new translation to keep the cursor point fixed
        state.setTranslate(
          mx - centerX - gx * newScale,
          my - centerY - gy * newScale,
        );
        state.setScale(newScale);

        updateTransform();
        getElement<HTMLDivElement>("zoomLevel").textContent =
          `${Math.round(state.scale * 100)}%`;
      } else {
        // Pan with scroll
        e.preventDefault();
        state.setTranslate(
          state.translateX - e.deltaX * 0.5,
          state.translateY - e.deltaY * 0.5,
        );
        updateTransform();
      }
    },
    { passive: false },
  );
}

/**
 * Hide hint after timeout
 */
export function setupHintTimeout(): void {
  setTimeout(() => {
    const hint = getElement<HTMLDivElement>("hint");
    hint.style.opacity = "0";
    setTimeout(() => (hint.style.display = "none"), 300);
  }, 5000);
}
