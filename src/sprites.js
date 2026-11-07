// Hand-placed pixel sprites. One character per pixel; "." is empty.
//
// The cat follows the user's reference sheet: a 22 x 14 side view facing left, a 9 x 7 head with a 1 x 2 eye
// either side of a light muzzle, pink inner ears, an outline in a darker shade of the coat rather than flat
// black, four stick legs and a tail that curls up at the tip. The rows use coat roles, not colors, so every
// coat in COATS shares one drawing.
//
//   O darkest outline   D dark outline   o outline   S shade   B base coat   T stripe / patch
//   L light (muzzle, chest)   M muzzle shade   P pink   E eye top   e eye bottom
//   r scarf   R scarf shade   h harness strap   y harness ring   b pack   K pack shade

export const COATS = {
  ginger: {
    name: "GINGER",
    O: "#351f07", D: "#442a0f", o: "#603f1e", S: "#c07d48", B: "#db925d", T: "#c67735",
    L: "#e3b480", M: "#b58650", P: "#ebada0", E: "#351f07", e: "#603f1e",
  },
  snow: {
    name: "SNOW",
    O: "#2c2825", D: "#54473f", o: "#6f655b", S: "#c3bab3", B: "#ffffff", T: "#9b8e85",
    L: "#ffffff", M: "#e1dad4", P: "#ebada0", E: "#253370", e: "#6977a8",
  },
  coal: {
    name: "COAL",
    O: "#000000", D: "#000000", o: "#000000", S: "#2e2e2e", B: "#403c3b", T: "#363231",
    L: "#acacaa", M: "#202020", P: "#e9aea0", E: "#151d0e", e: "#60803f",
  },
};
export const GEAR = { r: "#e0403c", R: "#8e1d2e", h: "#6a4a32", y: "#f4c64a", b: "#5f8a5a", K: "#3c5a3c" };

/** The palette for a coat: its colors plus the scarf and harness. */
export const palette = (coat) => ({ ...COATS[coat], ...GEAR });

// The reference pose, unchanged but for the scarf at the neck.
const STAND = [
  ".oO...oo..............",
  "oSSO.oBPD.............",
  "oSSOOBPPD.............",
  "oBBTTBBBD.............",
  "oTBTTBBTD.............",
  "OBEBBEBBD...........o.",
  "OBeLLeBrr..........oSD",
  ".OLLLLLrrODDDDoooooSSO",
  "..ODMMBRRTBTBTBBSBSSO.",
  "..OBBLLLLTBTBTLDOOOO..",
  "..oBBBBLLLLLLLBD......",
  "..oBOBDSSSSSSBBD......",
  "..oSOSDODDDDDDBD......",
  "..oSOSD....OSOSD......",
];

const edit = (rows, changes) =>
  rows.map((r, y) => {
    const c = changes[y];
    if (c === undefined) return r;
    if (typeof c === "string") return c;
    const s = [...r];
    for (const [x, ch] of c) s[x] = ch;
    return s.join("");
  });

// Hanging from the harness under the open canopy: the reference pose with a ring on its back, legs dangling.
const HANG = edit(STAND, { 6: [[13, "y"]], 7: [[13, "h"]], 8: [[13, "h"]] });
export const GLIDE = [
  HANG,
  // legs swing back a step in the wind
  edit(HANG, { 13: "...oSOSD....OSOSD....." }),
  // blink
  edit(HANG, { 5: [[2, "B"], [5, "B"]], 6: [[2, "O"], [5, "O"]] }),
];
export const GLIDE_RING = [13, 6];
export const GLIDE_SCARF = [8, 7];

// Diving with the canopy packed: ears pinned flat, eyes squeezed shut, front legs thrown forward, hind legs
// trailing, the pack on its back.
const DIVE_BASE = edit(STAND, {
  0: "......................",
  1: ".oOO..ooD.............",
  2: "oSSOOBPPD.............",
  5: [[2, "B"], [5, "B"]],
  6: [[2, "O"], [5, "O"], [12, "o"], [13, "o"], [14, "o"], [15, "o"]],
  7: [[11, "o"], [12, "b"], [13, "b"], [14, "b"], [15, "b"], [16, "o"]],
  11: "oSSSSODDDDDDDDOSSSSSD.",
  12: "oOOOOO........OOOOOOD.",
  13: "......................",
});
export const DIVE = [
  DIVE_BASE,
  // legs flutter
  edit(DIVE_BASE, { 11: ".oSSSODDDDDDDDOSSSSD..", 12: ".oOOOO........OOOOOD..", 10: [[0, "."]] }),
];
export const DIVE_SCARF = [8, 7];

export const CAT_W = STAND[0].length, CAT_H = STAND.length;
