import { FileText } from 'lucide-react';
import './PathChip.css';

export type PathChipState = 'seen' | 'read' | 'proposed' | 'changed';

/** Middle-truncate: keep the directory start and the file name visible. */
function split(path: string): { head: string; tail: string } {
  const cut = path.lastIndexOf('/');
  if (cut < 0) return { head: '', tail: path };
  return { head: path.slice(0, cut + 1), tail: path.slice(cut + 1) };
}

export function PathChip({
  path,
  state = 'seen',
  onClick,
}: {
  path: string;
  state?: PathChipState;
  onClick?: () => void;
}) {
  const { head, tail } = split(path);
  const content = (
    <>
      <FileText size={14} aria-hidden="true" />
      <span className="nb-path-chip__text">
        {head ? <span className="nb-path-chip__head">{head}</span> : null}
        <span className="nb-path-chip__tail">{tail}</span>
      </span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="nb-path-chip" data-state={state} title={path} onClick={onClick}>
        {content}
      </button>
    );
  }
  return (
    <span className="nb-path-chip" data-state={state} title={path}>
      {content}
    </span>
  );
}
