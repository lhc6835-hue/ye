// pixelfx's fonts have letters and digits only; the game also needs a little punctuation.
import { FONTS } from "../vendor/pixelfx/core/index.js";

function add(font, ch, src) {
  const rows = src.split("|");
  FONTS[font].glyphs[ch] = { w: rows[0].length, rows: rows.map((r) => [...r].map((c) => c === "#")) };
}

add("mini", "!", "#|#|#|.|#");
add("mini", ":", ".|#|.|#|.");
add("mini", ".", ".|.|.|.|#");
add("mini", "-", "...|...|###|...|...");
add("mini", "+", "...|.#.|###|.#.|...");
add("mini", "<", "..#|.#.|#..|.#.|..#");
add("mini", ">", "#..|.#.|..#|.#.|#..");
add("mini", "?", "##.|..#|.#.|...|.#.");
add("mini", "x", "...|#.#|.#.|#.#|...");
add("big", "!", "##|##|##|##|##|..|##");
add("big", "-", "....|....|....|####|....|....|....");
add("big", "+", ".....|..#..|..#..|#####|..#..|..#..|.....");
