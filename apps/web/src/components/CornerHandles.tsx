import { useRef } from 'react';
import type { Quad, Vec2 } from '@curtain/engine';

interface Props {
  width: number;
  height: number;
  corners: Quad;
  invalid: boolean;
  onChange: (q: Quad) => void;
}

const LABELS = ['Sol üst köşe', 'Sağ üst köşe', 'Sağ alt köşe', 'Sol alt köşe'];

/** SVG overlay in image pixel coordinates; draggable with mouse, touch and arrow keys. */
export function CornerHandles({ width, height, corners, invalid, onChange }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const r = Math.max(width, height) / 70;

  const toImage = (e: React.PointerEvent): Vec2 => {
    const rect = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const y = ((e.clientY - rect.top) / rect.height) * height;
    return [Math.min(width, Math.max(0, x)), Math.min(height, Math.max(0, y))];
  };

  const move = (i: number, p: Vec2) => {
    const next = corners.map((c) => [...c]) as Quad;
    next[i] = p;
    onChange(next);
  };

  return (
    <svg
      ref={svg}
      className="corners"
      viewBox={`0 0 ${width} ${height}`}
      onPointerMove={(e) => dragging.current !== null && move(dragging.current, toImage(e))}
      onPointerUp={() => (dragging.current = null)}
      onPointerCancel={() => (dragging.current = null)}
    >
      <polygon
        points={corners.map((c) => c.join(',')).join(' ')}
        className={invalid ? 'quad is-invalid' : 'quad'}
        strokeWidth={r / 4}
      />
      {corners.map((c, i) => (
        <circle
          key={i}
          cx={c[0]}
          cy={c[1]}
          r={r}
          className="handle"
          strokeWidth={r / 4}
          tabIndex={0}
          role="slider"
          aria-label={LABELS[i]}
          aria-valuetext={`${Math.round(c[0])}, ${Math.round(c[1])}`}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture(e.pointerId);
            dragging.current = i;
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 10 : 2;
            const d: Record<string, Vec2> = {
              ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
            };
            if (d[e.key]) {
              e.preventDefault();
              move(i, [c[0] + d[e.key][0], c[1] + d[e.key][1]]);
            }
          }}
        />
      ))}
    </svg>
  );
}
