import './Kbd.css';

export function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className="nb-kbd" aria-hidden="true">
      {keys.map((key, i) => (
        <kbd className="nb-kbd__key" key={`${key}-${i}`}>
          {key}
        </kbd>
      ))}
    </span>
  );
}
