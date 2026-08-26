/**
 * A day of glucose, generated the same way the demo seeder generates it.
 *
 * Deterministic, so the page renders identically on the server and the client
 * and does not shift under the reader on hydration. The shape is the point:
 * a dawn rise, three meals, and one of them followed by a walk.
 */
export interface Reading {
  minutes: number;
  mmol: number;
}

export const TARGET_LOW = 3.9;
export const TARGET_HIGH = 10.0;

interface Meal {
  atMinutes: number;
  carbs: number;
  walked: boolean;
  label: string;
}

export const DAY_MEALS: Meal[] = [
  { atMinutes: 7 * 60 + 20, carbs: 45, walked: false, label: 'Porridge with berries' },
  { atMinutes: 13 * 60 + 5, carbs: 62, walked: true, label: 'Rice and vegetables' },
  { atMinutes: 20 * 60 + 40, carbs: 75, walked: false, label: 'Pasta with sauce' },
];

/** Mirrors the seeder: a walk within the window blunts the rise by ~1.3 mmol/L. */
const WALK_EFFECT = -1.3;

function noise(step: number): number {
  // A fixed, cheap wobble so the trace reads as measured rather than drawn.
  return (Math.sin(step * 12.9898) * 43758.5453) % 1;
}

export function buildDay(intervalMinutes = 15): Reading[] {
  const readings: Reading[] = [];

  for (let minutes = 0; minutes <= 24 * 60; minutes += intervalMinutes) {
    const hour = minutes / 60;
    let value = 5.9 + 0.9 * Math.exp(-((hour - 6.5) ** 2) / 5);

    for (const meal of DAY_MEALS) {
      const since = minutes - meal.atMinutes;
      if (since < 0 || since > 240) continue;

      const shape = Math.exp(-((since - 60) ** 2) / 1800);
      let amplitude = (meal.carbs / 45) * 3.3;
      if (meal.walked) amplitude += WALK_EFFECT;
      if (meal.atMinutes >= 20 * 60) amplitude += 0.9;
      value += Math.max(0, amplitude) * shape;
    }

    readings.push({
      minutes,
      mmol: Math.round((value + noise(minutes) * 0.28) * 10) / 10,
    });
  }

  return readings;
}

export function timeLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
