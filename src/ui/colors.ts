/**
 * Tonalità (0–360) di un gruppo: angolo aureo sul cerchio dei colori, così i gruppi vicini si
 * distinguono. Parte dal blu (200°) per non confondere S1 col rosso usato per gli errori.
 */
export function groupHue(group: number): number {
  return (200 + group * 137.508) % 360;
}

export function groupColor(group: number | null): string {
  if (group === null) return 'var(--muted)';
  return `hsl(${Math.round(groupHue(group))} 62% 52%)`;
}
