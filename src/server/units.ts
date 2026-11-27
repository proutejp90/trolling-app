/** Measurements are stored in metric as received. These convert at the edges: the engine and the screen use feet, mph and °F. */
export const cToF = (c: number) => (c * 9) / 5 + 32;
export const mToFt = (m: number) => m * 3.28084;
export const msToMph = (ms: number) => ms * 2.23694;
export const kmhToMs = (kmh: number) => kmh / 3.6;
/** Seagull reports temperatures in kelvin. */
export const kToC = (k: number) => k - 273.15;
export const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;
