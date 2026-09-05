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
