import type { CSSProperties, ReactNode } from 'react';
import { fnv, TINTS, type Look, type LookId } from './looks';
import './Critter.css';

/**
 * The Notbot character: one soft, fluffy creature with a pale face, and a wardrobe of hats and
 * helmets drawn on top. Everything is plain SVG, so it scales to any size and works in both themes.
 */

const INK = '#3A2A22';

interface Dress {
  /** Drawn behind the body, such as ears. */
  back?: ReactNode;
  /** Drawn over the head. */
  front?: ReactNode;
}

const wardrobe: Record<LookId, Dress> = {
  plain: {},

  cowboy: {
    front: (
      <g>
        <path
          d="M10 36 C 22 47, 98 47, 110 36 C 102 28, 92 31, 60 31 C 28 31, 18 28, 10 36 Z"
          fill="#C58B4B"
          stroke="#8A5A26"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path
          d="M35 33 C 32 14, 41 6, 52 11 C 56 14, 64 14, 68 11 C 79 6, 88 14, 85 33 Z"
          fill="#D0A062"
          stroke="#8A5A26"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M52 11 Q60 19 68 11" fill="none" stroke="#8A5A26" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M35.4 28 L84.6 28 L85 33 L35 33 Z" fill="#6B3F1D" />
        <rect x="56" y="27" width="8" height="7" rx="1.5" fill="#E8C34A" stroke="#B8860B" strokeWidth="0.8" />
      </g>
    ),
  },

  trooper: {
    front: (
      <g strokeLinejoin="round" strokeLinecap="round">
        <path
          d="M22 60 C 19 28, 37 9, 60 9 C 83 9, 101 28, 98 60 C 97 74, 91 82, 84 84 L 36 84 C 29 82, 23 74, 22 60 Z"
          fill="#F7F9FB"
          stroke="#26262B"
          strokeWidth="1.8"
        />
        <path d="M27 36 Q60 20 93 36" fill="none" stroke="#26262B" strokeWidth="2.2" />
        <path d="M33 38 L55 41 L53 55 C 46 59 38 55 35 48 Z" fill="#141416" />
        <path d="M87 38 L65 41 L67 55 C 74 59 82 55 85 48 Z" fill="#141416" />
        <path d="M60 52 L56 63 L64 63 Z" fill="#9AA3AB" />
        <path d="M30 56 q-3 10 1 18 M90 56 q3 10 -1 18" fill="none" stroke="#141416" strokeWidth="2.6" />
        <rect x="46" y="68" width="28" height="12" rx="3" fill="#2A2A2F" />
        <path d="M52 69 v10 M57 69 v10 M63 69 v10 M68 69 v10" stroke="#F7F9FB" strokeWidth="1.8" />
        <path d="M24 66 C 24 74, 29 80, 36 83" fill="none" stroke="#C9D0D6" strokeWidth="2" />
      </g>
    ),
  },

  wizard: {
    front: (
      <g strokeLinejoin="round">
        <path
          d="M38 36 C 44 16, 56 -2, 68 -16 C 71 4, 80 22, 84 36 Z"
          fill="#4747B8"
          stroke="#2C2C86"
          strokeWidth="1.4"
        />
        <ellipse cx="60" cy="36" rx="38" ry="8.5" fill="#3A3AA3" stroke="#2C2C86" strokeWidth="1.4" />
        <path d="M40 31 Q62 38 83 31 L84 36 Q62 44 39 36 Z" fill="#F2C233" opacity="0.9" />
        <path d="M62 8 l2 4.4 4.8 .6 -3.5 3.3 .9 4.7 -4.2 -2.3 -4.2 2.3 .9 -4.7 -3.5 -3.3 4.8 -.6 z" fill="#FFE27A" />
        <circle cx="72" cy="22" r="1.8" fill="#FFE27A" />
        <circle cx="54" cy="24" r="1.4" fill="#FFE27A" />
      </g>
    ),
  },

  astronaut: {
    front: (
      <g>
        <ellipse cx="60" cy="88" rx="32" ry="7" fill="#D6DCE2" stroke="#A9B2BB" strokeWidth="1.4" />
        <circle cx="60" cy="54" r="37" fill="url(#nb-glass)" stroke="#E6EAEE" strokeWidth="5" />
        <circle cx="60" cy="54" r="39.5" fill="none" stroke="#B7C0C9" strokeWidth="1.4" />
        <path d="M36 34 Q42 25 54 22" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" opacity="0.85" />
        <circle cx="82" cy="74" r="2.2" fill="#FFFFFF" opacity="0.7" />
      </g>
    ),
  },

  chef: {
    front: (
      <g stroke="#DCDFE3" strokeWidth="1">
        <circle cx="42" cy="20" r="12" fill="#FFFFFF" />
        <circle cx="78" cy="20" r="12" fill="#FFFFFF" />
        <circle cx="60" cy="12" r="15" fill="#FFFFFF" />
        <rect x="38" y="24" width="44" height="14" rx="4" fill="#FFFFFF" />
        <path d="M46 28 v6 M54 28 v6 M62 28 v6 M70 28 v6" stroke="#E6E8EB" strokeWidth="1.2" fill="none" />
      </g>
    ),
  },

  crown: {
    front: (
      <g strokeLinejoin="round">
        <path
          d="M36 34 L 37 11 L 49 23 L 60 6 L 71 23 L 83 11 L 84 34 Z"
          fill="#F4C93A"
          stroke="#B8860B"
          strokeWidth="1.5"
        />
        <rect x="36" y="29" width="48" height="7" rx="2" fill="#E0AC1E" stroke="#B8860B" strokeWidth="1.2" />
        <circle cx="60" cy="22" r="3" fill="#E5484D" stroke="#9F2328" strokeWidth="0.8" />
        <circle cx="46" cy="32.5" r="2" fill="#3B82F6" />
        <circle cx="60" cy="32.5" r="2" fill="#3B82F6" />
        <circle cx="74" cy="32.5" r="2" fill="#3B82F6" />
        <circle cx="37" cy="10" r="2.4" fill="#FFE27A" />
        <circle cx="60" cy="5" r="2.4" fill="#FFE27A" />
        <circle cx="83" cy="10" r="2.4" fill="#FFE27A" />
      </g>
    ),
  },

  headphones: {
    front: (
      <g strokeLinecap="round">
        <path d="M22 62 C 18 14, 102 14, 98 62" fill="none" stroke="#2B2F36" strokeWidth="6" />
        <rect x="12" y="46" width="17" height="30" rx="8" fill="#3A3F48" stroke="#22262C" strokeWidth="1.4" />
        <rect x="91" y="46" width="17" height="30" rx="8" fill="#3A3F48" stroke="#22262C" strokeWidth="1.4" />
        <circle cx="20.5" cy="61" r="4" fill="#0866FF" />
        <circle cx="99.5" cy="61" r="4" fill="#0866FF" />
      </g>
    ),
  },

  beanie: {
    front: (
      <g strokeLinejoin="round">
        <path d="M27 38 C 27 12, 93 12, 93 38 Z" fill="#E5484D" stroke="#9F2328" strokeWidth="1.4" />
        <path d="M40 17 Q42 28 41 38 M60 13 Q61 26 60 38 M80 17 Q78 28 79 38" fill="none" stroke="#C93A3F" strokeWidth="2" />
        <rect x="25" y="32" width="70" height="12" rx="5" fill="#F25F63" stroke="#9F2328" strokeWidth="1.4" />
        <path d="M32 33 v10 M42 33 v10 M52 33 v10 M62 33 v10 M72 33 v10 M82 33 v10" stroke="#D43B40" strokeWidth="1.6" fill="none" />
        <circle cx="60" cy="9" r="9" fill="#FFFFFF" stroke="#DCDFE3" strokeWidth="1.2" />
      </g>
    ),
  },

  bunny: {
    back: (
      <g>
        <g transform="rotate(-10 40 6)">
          <ellipse cx="40" cy="2" rx="10" ry="27" className="nb-critter__fur" />
          <ellipse cx="40" cy="4" rx="5" ry="20" fill="#F6B8C0" />
        </g>
        <g transform="rotate(10 80 6)">
          <ellipse cx="80" cy="2" rx="10" ry="27" className="nb-critter__fur" />
          <ellipse cx="80" cy="4" rx="5" ry="20" fill="#F6B8C0" />
        </g>
      </g>
    ),
  },
};

/** A few short strokes on the lower body, in fixed spots, to read as fur. */
const furStrokes = (() => {
  const strokes: string[] = [];
  let i = 0;
  for (let y = 80; y <= 108; y += 8) {
    for (let x = 26 + ((y / 8) % 2) * 6; x <= 94; x += 12) {
      const jx = ((i * 7) % 5) - 2;
      const jy = ((i * 3) % 3) - 1;
      strokes.push(`M${x + jx} ${y + jy} q2.6 3 0 6.4`);
      i += 1;
    }
  }
  return strokes;
})();

export function Critter({ look, name, size }: { look: Look; name: string; size: number }) {
  const tint = TINTS.find((item) => item.id === look.tint) ?? TINTS[0];
  const dress = wardrobe[look.look];
  const delay = `${(fnv(name) % 4000) / 1000}s`;
  return (
    <svg
      className="nb-critter"
      width={size}
      height={size}
      viewBox="-8 -22 136 144"
      role="img"
      aria-hidden="true"
      style={
        {
          '--nb-critter-fur': tint.fur,
          '--nb-critter-shade': tint.shade,
          '--nb-critter-blink': delay,
        } as CSSProperties
      }
    >
      <defs>
        <filter id="nb-fluff" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <linearGradient id="nb-fur-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.45" />
          <stop offset="0.55" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.1" />
        </linearGradient>
        <radialGradient id="nb-glass" cx="0.35" cy="0.3" r="0.9">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.5" />
          <stop offset="0.6" stopColor="#BFE0FF" stopOpacity="0.16" />
          <stop offset="1" stopColor="#7FB6F5" stopOpacity="0.3" />
        </radialGradient>
        <filter id="nb-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>

      {dress.back}

      <g filter="url(#nb-fluff)">
        <ellipse cx="17" cy="88" rx="8.5" ry="16" transform="rotate(14 17 88)" className="nb-critter__fur" />
        <ellipse cx="103" cy="88" rx="8.5" ry="16" transform="rotate(-14 103 88)" className="nb-critter__fur" />
        <path
          d="M60 12 C 86 12, 101 34, 102 60 C 103 86, 109 108, 94 115 L 26 115 C 11 108, 17 86, 18 60 C 19 34, 34 12, 60 12 Z"
          className="nb-critter__fur"
        />
      </g>
      <path
        d="M60 12 C 86 12, 101 34, 102 60 C 103 86, 109 108, 94 115 L 26 115 C 11 108, 17 86, 18 60 C 19 34, 34 12, 60 12 Z"
        fill="url(#nb-fur-shade)"
      />
      <g fill="none" strokeLinecap="round" className="nb-critter__strokes">
        {furStrokes.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>

      <ellipse cx="60" cy="53" rx="28" ry="24.5" fill={tint.face} />
      <ellipse cx="60" cy="53" rx="28" ry="24.5" fill="none" stroke={tint.shade} strokeOpacity="0.55" strokeWidth="1.6" />

      <g className="nb-critter__eyes">
        <ellipse cx="50" cy="51" rx="3.5" ry="4.3" fill={INK} />
        <ellipse cx="70" cy="51" rx="3.5" ry="4.3" fill={INK} />
        <circle cx="51.2" cy="49.4" r="1.2" fill="#FFFFFF" />
        <circle cx="71.2" cy="49.4" r="1.2" fill="#FFFFFF" />
      </g>
      <circle cx="42" cy="61" r="5.6" fill="#F4A3A0" opacity="0.7" filter="url(#nb-soft)" />
      <circle cx="78" cy="61" r="5.6" fill="#F4A3A0" opacity="0.7" filter="url(#nb-soft)" />
      <path d="M55 60.5 Q60 65.5 65 60.5" fill="none" stroke={INK} strokeWidth="1.7" strokeLinecap="round" />

      {dress.front}
    </svg>
  );
}

export type { LookId };
