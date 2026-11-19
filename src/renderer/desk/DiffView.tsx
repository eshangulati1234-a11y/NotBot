import type { ParsedDiff } from '../lib/diff';
import './DiffView.css';

interface Props {
  diff: ParsedDiff;
}

const SIGN = { add: '+', del: '-', ctx: ' ' } as const;
const SPOKEN = { add: 'Added: ', del: 'Removed: ', ctx: '' } as const;

export function DiffView({ diff }: Props) {
  const empty = diff.hunks.every((h) => h.lines.length === 0);
  return (
    <div className="nb-diff-view" role="group" aria-label={`Changes to ${diff.path}`}>
      <div className="nb-diff-view__summary">
        {diff.isNew ? <span className="nb-diff-view__tag">New file</span> : null}
        <span className="nb-diff-view__stat" data-kind="add">
          +{diff.added}
        </span>
        <span className="nb-diff-view__stat" data-kind="del">
          -{diff.removed}
        </span>
      </div>
      {diff.truncated ? (
        <p className="nb-diff-view__notice" role="note">
          This change is large, so the preview stops early. Applying it still writes the complete change.
        </p>
      ) : null}
      {empty ? (
        <p className="nb-diff-view__empty">There are no visible line changes to show.</p>
      ) : (
        <div className="nb-diff-view__scroll">
          <div className="nb-diff-view__body">
            {diff.hunks.map((hunk, h) => (
              <div className="nb-diff-view__hunk" key={`${h}:${hunk.header}`}>
                {!diff.isNew && hunk.header ? <div className="nb-diff-view__header">{hunk.header}</div> : null}
                {hunk.lines.map((line, i) => (
                  <div className="nb-diff-view__line" data-kind={line.kind} key={i}>
                    <span className="nb-diff-view__no" aria-hidden="true">
                      {line.oldNo ?? ''}
                    </span>
                    <span className="nb-diff-view__no" aria-hidden="true">
                      {line.newNo ?? ''}
                    </span>
                    <span className="nb-diff-view__sign" aria-hidden="true">
                      {SIGN[line.kind]}
                    </span>
                    <span className="nb-diff-view__text">
                      <span className="nb-diff-view__sr">{SPOKEN[line.kind]}</span>
                      {line.text || ' '}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
