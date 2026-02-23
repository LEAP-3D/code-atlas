// User interactions: pan, zoom, drag

import * as state from "./state";
import { getElement } from "./utils";
import { closeFunctionPanel, updateBreadcrumb } from "./panel";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }

  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function bandOpacity(
  pxSpacing: number,
  minPx: number,
  idealStartPx: number,
  idealEndPx: number,
  maxPx: number,
): number {
  const fadeIn = smoothstep(minPx, idealStartPx, pxSpacing);
  const fadeOut = 1 - smoothstep(idealEndPx, maxPx, pxSpacing);
  return clamp01(fadeIn * fadeOut);
}

function worldLineWidthForScreenPx(targetScreenPx: number): number {
  return Math.max(1, targetScreenPx / Math.max(state.scale, 0.001));
}

function updateGridBackgroundLOD(): void {
  const graph = getElement<HTMLDivElement>("graphContainer");

  const fineSpacing = 50 * state.scale;
  const mediumSpacing = 200 * state.scale;
  const coarseSpacing = 800 * state.scale;

  // Each grid only renders in its own visible screen-space spacing band.
  // When spacing becomes too dense/sparse, it fades out and the next layer takes over.
  const fineAlpha = 0.04 * bandOpacity(fineSpacing, 7, 14, 80, 140);
  const mediumAlpha = 0.05 * bandOpacity(mediumSpacing, 10, 18, 110, 190);
  const coarseAlpha = 0.06 * bandOpacity(coarseSpacing, 14, 26, 150, 260);
  const lineWidth = worldLineWidthForScreenPx(1);

  graph.style.setProperty("--grid-spacing-1", "50px");
  graph.style.setProperty("--grid-spacing-2", "200px");
  graph.style.setProperty("--grid-spacing-3", "800px");
  graph.style.setProperty("--grid-line-width-1", `${lineWidth.toFixed(2)}px`);
  graph.style.setProperty("--grid-line-width-2", `${lineWidth.toFixed(2)}px`);
  graph.style.setProperty("--grid-line-width-3", `${lineWidth.toFixed(2)}px`);
  graph.style.setProperty("--grid-line-alpha-1", fineAlpha.toFixed(4));
  graph.style.setProperty("--grid-line-alpha-2", mediumAlpha.toFixed(4));
  graph.style.setProperty("--grid-line-alpha-3", coarseAlpha.toFixed(4));
}

/**
 * Update graph transform (position and scale)
 */
export function updateTransform(): void {
  const graph = getElement<HTMLDivElement>("graphContainer");
  graph.style.transform =
    `translate(calc(-50% + ${state.translateX}px), calc(-50% + ${state.translateY}px)) scale(${state.scale})`;
  updateGridBackgroundLOD();
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
 * Reset view to show all nodes - PROPERLY FIXED VERSION
 *
 * The graph container is 10000x10000px positioned with transform-origin at center.
 * Nodes are positioned in absolute coordinates within this container.
 * The CSS applies: translate(-50%, -50%) which centers the container.
 *
 * We need to calculate the offset to center all visible nodes in the viewport.
 */
export function resetView(): void {
  state.setFocusedFile(null);

  if (state.allNodes.length > 0) {
    // Step 1: Find the bounding box of all nodes
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

    // Step 2: Calculate graph center (in the 10000x10000 space)
    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;
    const graphWidth = maxX - minX + 200;
    const graphHeight = maxY - minY + 200;

    // Step 3: Get viewport dimensions
    const canvas = getElement<HTMLDivElement>("canvas");
    const rect = canvas.getBoundingClientRect();

    // Step 4: Calculate optimal scale
    const newScale = Math.max(
      state.MIN_SCALE,
      Math.min(
        (rect.width * 0.9) / graphWidth,
        (rect.height * 0.9) / graphHeight,
        1,
      ),
    );

    // Step 5: Calculate translation
    // The graph container has a base position of translate(-50%, -50%)
    // which means its center (5000, 5000) is at the viewport center by default.
    // We need to offset from that to move our actual graph center to viewport center.
    //
    // Offset needed = (container_center - graph_center) * scale
    const CONTAINER_CENTER = 5000; // The 10000x10000 container's center

    const translateX = (CONTAINER_CENTER - graphCenterX) * newScale;
    const translateY = (CONTAINER_CENTER - graphCenterY) * newScale;

    state.setScale(newScale);
    state.setTranslate(translateX, translateY);
  } else {
    state.setScale(0.5);
    state.setTranslate(0, 0);
  }

  // Reset visual styles
  state.allNodes.forEach((n) =>
    n.element.classList.remove("focused", "dimmed", "small", "dependency"),
  );

  state.connections.forEach(({ line }) =>
    line.classList.remove("highlight", "dependency-line"),
  );

  // Update UI
  updateTransform();
  getElement<HTMLDivElement>("zoomLevel").textContent =
    `${Math.round(state.scale * 100)}%`;
  updateBreadcrumb("Full Map");
  closeFunctionPanel();
  const panelToggle = getElement<HTMLButtonElement>("panelToggle");
  panelToggle.classList.remove("active", "panel-open");
}

/**
 * Setup canvas event listeners
 */
export function setupCanvasEvents(): void {
  const canvas = getElement<HTMLDivElement>("canvas");
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let hasDragged = false;

  // Mouse down - start drag
  canvas.addEventListener("mousedown", (e) => {
    if (
      e.target === canvas ||
      (e.target as HTMLElement).closest("#graphContainer")
    ) {
      state.setDragging(true);
      dragStartClientX = e.clientX;
      dragStartClientY = e.clientY;
      hasDragged = false;
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
      if (
        Math.abs(e.clientX - dragStartClientX) > 4 ||
        Math.abs(e.clientY - dragStartClientY) > 4
      ) {
        hasDragged = true;
      }
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

  // Click on background closes sidebar only (selection/highlights stay)
  canvas.addEventListener("click", (e) => {
    if (hasDragged) {
      hasDragged = false;
      return;
    }

    const target = e.target as HTMLElement;
    if (target.closest(".node")) {
      return;
    }

    closeFunctionPanel();
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
