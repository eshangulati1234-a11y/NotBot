import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import './Segmented.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  detail?: string;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (event: KeyboardEvent, index: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  const selected = options.some((o) => o.value === value);
  return (
    <div className="nb-segmented" role="radiogroup" aria-label={label}>
      {options.map((option, i) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (!selected && i === 0) ? 0 : -1}
            className="nb-segmented__option"
            data-detail={option.detail ? '' : undefined}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => move(e, i)}
          >
            <span className="nb-segmented__label">{option.label}</span>
            {option.detail ? <span className="nb-segmented__detail">{option.detail}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
