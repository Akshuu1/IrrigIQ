/**
 * IrrigIQ Pseudo-localisation Utilities
 *
 * Expands text length by ~30-40% using accented characters and brackets.
 * Used to verify UI components can accommodate translated text without clipping or overflow at 320px.
 */

const ACCENT_MAP: Record<string, string> = {
  a: 'ä',
  b: 'ƀ',
  c: 'ç',
  d: 'đ',
  e: 'ë',
  f: 'ƒ',
  g: 'ğ',
  h: 'ĥ',
  i: 'ï',
  j: 'ĵ',
  k: 'ķ',
  l: 'ł',
  m: 'm̂',
  n: 'ñ',
  o: 'ö',
  p: 'þ',
  q: 'q̂',
  r: 'ř',
  s: 'š',
  t: 'ţ',
  u: 'ü',
  v: 'ṽ',
  w: 'ŵ',
  x: 'x̂',
  y: 'ÿ',
  z: 'ž',
  A: 'Ä',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Đ',
  E: 'Ë',
  F: 'Ƒ',
  G: 'Ğ',
  H: 'Ĥ',
  I: 'Ï',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ł',
  M: 'M̂',
  N: 'Ñ',
  O: 'Ö',
  P: 'Þ',
  Q: 'Q̂',
  R: 'Ř',
  S: 'Š',
  T: 'Ţ',
  U: 'Ü',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'X̂',
  Y: 'Ÿ',
  Z: 'Ž',
};

/**
 * Transforms an ASCII/English string into pseudo-localised text.
 * Leaves placeholder variables such as {{count}}, {{name}}, {param} untouched.
 */
export function pseudoLocalize(str: string): string {
  if (!str || typeof str !== 'string') return str;

  // Preserve template interpolation tokens {{...}} and {...}
  const parts = str.split(/(\{\{[^}]+\}\}|\{[^}]+\})/g);
  const transformed = parts
    .map((part) => {
      if (part.startsWith('{') && part.endsWith('}')) {
        return part;
      }
      return part
        .split('')
        .map((ch) => ACCENT_MAP[ch] || ch)
        .join('');
    })
    .join('');

  return `[!!! ${transformed} !!!]`;
}

