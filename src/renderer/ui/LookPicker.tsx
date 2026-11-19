import { Canvas } from '@react-three/fiber';
import { Critter } from './Critter';
import { LOOKS, TINTS, type Look } from './looks';
import { PlushScene } from './3d/Plush';
import { canDraw3d } from './3d/webgl';
import './LookPicker.css';

/** Lets someone dress their helper: a live preview, an outfit and a fur colour. */
export function LookPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: Look;
  onChange: (look: Look) => void;
}) {
  return (
    <div className="nb-look-picker">
      <div className="nb-look-picker__preview" aria-hidden="true">
        {canDraw3d() ? (
          // Dialogs sit above the shared stage, so the preview draws on its own small canvas.
          <Canvas flat dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
            <PlushScene look={value} state="idle" size={160} seed={0.3} still={false} />
          </Canvas>
        ) : (
          <Critter look={value} name={name} size={140} />
        )}
      </div>
      <div className="nb-look-picker__grid" role="radiogroup" aria-label="Outfit">
        {LOOKS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={value.look === item.id}
            className="nb-look-picker__option"
            onClick={() => onChange({ ...value, look: item.id })}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="nb-look-picker__tints" role="radiogroup" aria-label="Fur colour">
        {TINTS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={value.tint === item.id}
            aria-label={item.label}
            title={item.label}
            className="nb-look-picker__tint"
            style={{ background: item.fur }}
            onClick={() => onChange({ ...value, tint: item.id })}
          />
        ))}
      </div>
    </div>
  );
}
