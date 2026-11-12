/**
 * Hue (0–360) of a group: golden angle on the colour wheel, so neighbouring groups can be
 * told apart. Starts from blue (200°) so S1 is not confused with the red used for errors.
 */
export function groupHue(group: number): number {
  return (200 + group * 137.508) % 360;
}

export function groupColor(group: number | null): string {
  if (group === null) return 'var(--muted)';
  return `hsl(${Math.round(groupHue(group))} 62% 52%)`;
}
