// Screen and tuning constants. The game runs at 180 x 320 pixels, scaled up whole.

export const W = 180, H = 320;
export const WALL = 16; // each side wall's width
export const PLAY_L = WALL, PLAY_R = W - WALL, PLAY_W = PLAY_R - PLAY_L;
export const PX_PER_M = 10;

export const TUNE = {
  gravity: 560, // px/s² while diving
  diveSpeed: 175, // terminal speed with the canopy packed, at the top
  diveSpeedDeep: 300, // ... and deep down
  chuteSpeed: 34, // terminal speed under the open canopy
  chuteDrag: 7, // how hard the canopy brakes (1/s)
  openTime: 0.14, // seconds to unfold the canopy
  closeTime: 0.08, // seconds to pack it away
  moveSpeed: 96, // px/s sideways
  moveAccel: 900,
  moveBrake: 1100,
  multEvery: 1.1, // seconds of diving per multiplier step
  multMax: 9,
  deepAt: 2500, // metres at which the game is as hard as it gets
};
