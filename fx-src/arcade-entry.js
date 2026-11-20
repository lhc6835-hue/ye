// Bundle entry for the arcade hub: the pixelfx core plus only the custom arcade effects.
import { createFrame, clearFrame, createFx, composite } from "./src/core/index.js";
import * as synthHorizon from "./src/fx/arcade/synth-horizon.js";
import * as insertCoin from "./src/fx/arcade/insert-coin.js";
import * as crtPowerOn from "./src/fx/arcade/crt-power-on.js";
import * as pressStart from "./src/fx/arcade/press-start.js";
window.PixelFX = { createFrame, clearFrame, createFx, composite, fx: { synthHorizon, insertCoin, crtPowerOn, pressStart } };
