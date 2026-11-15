// SANDLINE look plan, in one place. Dusk desert-industrial: sand and ochre under a
// teal dusk sky, with one hot accent for the bomb, the HUD and the enemy visor.
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#2b2620', // dusk sky / fog
  sand: '#c8a06a', // sun-baked ground
  ochre: '#a67c3d', // weathered containers
  rust: '#8a4b2d', // rusted metal
  concrete: '#6f6a5e', // concrete walls
  teal: '#2f6f6a', // painted doors, trim
  dark: '#3a332a', // shadowed crates
  ink: '#f2e8d5', // warm off-white
  muted: '#a89a80', // dusty text
  accent: '#ff5a2a', // bomb, alerts
  enemy: '#e5484d', // enemy visor
  ally: '#2fae8f', // ally visor
};

export function shade(name) {
  return PALETTE[name];
}
