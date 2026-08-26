'use client';

import { useEffect, useRef, useState } from 'react';
import {
  buildDay,
  DAY_MEALS,
  TARGET_HIGH,
  TARGET_LOW,
  timeLabel,
} from './data';
import { useShown } from './useShown';

const SCALE_MIN = 3;
const SCALE_MAX = 15;

/**
 * A full day of glucose, drawn at the scale the page is built on.
 *
 * The target band is the ground, not an overlay: the trace is read against it,
 * which is how the reader learns the page's colour key without being told.
 * Meals are marked on the axis so the shape has a cause.
 */
export function DayTrace({ showMeals = true }: { showMeals?: boolean }) {
  const readings = useRef(buildDay()).current;
  const svgRef = useRef<SVGSVGElement>(null);
  const { ref, shown } = useShown<HTMLDivElement>('-8%');
  const [length, setLength] = useState(0);

  const x = (minutes: number) => (minutes / (24 * 60)) * 100;
  const y = (mmol: number) =>
    ((SCALE_MAX - mmol) / (SCALE_MAX - SCALE_MIN)) * 100;

  /**
   * The drawn length of the trace, in screen pixels.
   *
   * `getTotalLength()` reports user units, but `vector-effect:
   * non-scaling-stroke` makes `stroke-dasharray` screen units. Mixing the two
   * makes the dash far shorter than the rendered path, which silently chops
   * the trace into segments that read like gaps in the data. The viewBox is
   * also stretched (`preserveAspectRatio="none"`), so x and y scale by
   * different factors and the length has to be summed per segment.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const measure = () => {
      const { width, height } = svg.getBoundingClientRect();
      if (!width || !height) return;

      const sx = width / 100;
      const sy = height / 100;
      let total = 0;
      for (let i = 1; i < readings.length; i += 1) {
        const dx = (x(readings[i].minutes) - x(readings[i - 1].minutes)) * sx;
        const dy = (y(readings[i].mmol) - y(readings[i - 1].mmol)) * sy;
        total += Math.hypot(dx, dy);
      }
      setLength(Math.ceil(total));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [readings]);

  const d = readings
    .map((r, i) => `${i === 0 ? 'M' : 'L'} ${x(r.minutes).toFixed(3)} ${y(r.mmol).toFixed(3)}`)
    .join(' ');

  const peak = readings.reduce((a, b) => (b.mmol > a.mmol ? b : a));
  const inRange = readings.filter(
    (r) => r.mmol >= TARGET_LOW && r.mmol <= TARGET_HIGH,
  ).length;

  return (
    <div ref={ref}>
      <div
        className="relative"
        role="img"
        aria-label={`One day of glucose readings. ${Math.round((inRange / readings.length) * 100)} percent of the day within the target range of ${TARGET_LOW} to ${TARGET_HIGH} millimoles per litre. The highest reading was ${peak.mmol} at ${timeLabel(peak.minutes)}, after the evening meal.`}
      >
        <svg
          ref={svgRef}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-[clamp(9.5rem,21vw,16rem)] w-full"
          aria-hidden
        >
          {/* The band the whole page is built on. */}
          <rect
            x="0"
            y={y(TARGET_HIGH)}
            width="100"
            height={y(TARGET_LOW) - y(TARGET_HIGH)}
            fill="var(--in-range-wash)"
          />
          <line
            x1="0"
            x2="100"
            y1={y(TARGET_HIGH)}
            y2={y(TARGET_HIGH)}
            stroke="var(--in-range)"
            strokeWidth="1"
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
            opacity="0.55"
          />

          {showMeals &&
            DAY_MEALS.map((meal) => (
              <line
                key={meal.atMinutes}
                x1={x(meal.atMinutes)}
                x2={x(meal.atMinutes)}
                y1="0"
                y2="100"
                stroke="var(--brand-rule)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}

          <path
            d={d}
            fill="none"
            stroke="var(--brand-ink)"
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className={length ? 'trace-draw' : undefined}
            data-shown={shown}
            style={length ? { ['--trace-length' as string]: length } : undefined}
          />
        </svg>

      </div>

      <div className="mt-3 flex justify-between text-xs text-[var(--brand-ink-3)] measure">
        <span>00:00</span>
        <span aria-hidden>12:00</span>
        <span>24:00</span>
      </div>

      {/* Meal labels get their own band below the axis, so nothing can collide
          with the times. Position still ties each label to its gridline. */}
      {showMeals && (
        <div className="relative hidden h-14 sm:block" aria-hidden>
          {DAY_MEALS.map((meal) => (
            <span
              key={meal.atMinutes}
              className="absolute top-2 -translate-x-1/2 whitespace-nowrap text-center text-xs leading-tight text-[var(--brand-ink-3)]"
              style={{ left: `${Math.min(94, Math.max(6, x(meal.atMinutes)))}%` }}
            >
              {meal.label}
              {meal.walked && (
                <span className="mt-0.5 block text-[var(--in-range)]">
                  walked after
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
