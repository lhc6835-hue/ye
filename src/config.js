// Screen and tuning constants. The game runs at 180 x 320 pixels, scaled up whole.

export const W = 180, H = 320;
export const WALL = 16; // each side wall's width
export const PLAY_L = WALL, PLAY_R = W - WALL, PLAY_W = PLAY_R - PLAY_L;
export const PX_PER_M = 10;

export const TUNE = {
  gravity: 1150, // px/s² while diving
  diveSpeed: 270, // terminal speed with the canopy packed, at the top
  diveSpeedDeep: 470, // ... and deep down
  chuteSpeed: 66, // terminal speed under the open canopy
  chuteDrag: 9, // how hard the canopy brakes (1/s)
  openTime: 0.14, // seconds to unfold the canopy
  closeTime: 0.08, // seconds to pack it away
  moveSpeed: 128, // px/s sideways
  moveAccel: 1700,
  moveBrake: 1900,
  chuteSteer: 0.65, // sideways speed under the canopy, as a share of moveSpeed
  // the canopy can't stay open for ever: it drains while open and refills while diving
  canopyDrain: 0.5, // per second open (a full gauge lasts 2 s)
  canopyRefill: 0.3, // per second diving
  canopyReopen: 0.25, // a spent canopy opens again once refilled this far
  multEvery: 0.8, // seconds of diving per multiplier step
  multMax: 9,
  deepAt: 1500, // metres at which the game is as hard as it gets
};
