import { helperMark } from './mark';
import './HelperMark.css';

const GRID = 5;

export function HelperMark({ name, size = 28 }: { name: string; size?: 20 | 28 | 40 }) {
  const { cells, tone } = helperMark(name);
  return (
    <span className="nb-helper-mark" data-size={size} data-tone={tone} aria-hidden="true">
      <svg viewBox={`0 0 ${GRID} ${GRID}`} className="nb-helper-mark__grid" shapeRendering="crispEdges">
        {cells.map((on, i) =>
          on ? <rect key={i} x={i % GRID} y={Math.floor(i / GRID)} width={1} height={1} /> : null,
        )}
      </svg>
    </span>
  );
}
