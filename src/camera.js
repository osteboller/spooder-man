// The camera holds a world-space focus point (x,y) and a zoom level.
// toScreen() is the single place that converts world coordinates to canvas
// pixels — every draw call should go through it so panning/zooming stays consistent.
export const ANCHOR_X = 0.42; // player sits slightly left of screen center

export function createCamera(){
  return { x: 0, y: 0, zoom: 1 };
}

export function toScreen(cam, canvasW, canvasH, wx, wy){
  return {
    x: (wx - cam.x) * cam.zoom + canvasW * ANCHOR_X,
    y: (wy - cam.y) * cam.zoom + canvasH / 2
  };
}

// Inverse of toScreen — for turning a raw pointer position (a click, say)
// back into a world-space point that stays put as the camera moves.
export function toWorld(cam, canvasW, canvasH, sx, sy){
  return {
    x: (sx - canvasW * ANCHOR_X) / cam.zoom + cam.x,
    y: (sy - canvasH / 2) / cam.zoom + cam.y
  };
}
