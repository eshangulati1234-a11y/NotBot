import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Download, X } from 'lucide-react';
import type { ReviewItem } from '../lib/helpers';
import { newFileDiff, parseDiff, type ParsedDiff } from '../lib/diff';
import { isEditable, isMod, modKey, useShortcut } from '../lib/keys';
import { toolPhrase } from '../lib/status';
import { Button, IconButton, PathChip, Segmented, StatusDot } from '../ui';
import { DiffView } from './DiffView';
import './ReviewPane.css';

/** What happened after the person decided; shown once the request has left the queue. */
export interface ReviewOutcome {
  kind: 'applied' | 'rejected' | 'failed';
  /** True while an approved change is still being written. */
  pending: boolean;
  changed: string[];
  backupArtifactId: string | null;
}

interface Props {
  item: ReviewItem;
  index: number;
  total: number;
  busy: boolean;
  onDecide: (d: 'approve' | 'reject') => Promise<boolean>;
  onNext: () => void;
  onClose: () => void;
  /** Added by Desk: set after a decision so the pane can report the result. */
  outcome?: ReviewOutcome | null;
  onExport?: (artifactId: string) => void;
}

type View = 'changes' | 'whole';

/** How long the result stays up before the pane dismisses itself. */
const SETTLE_MS = 4000;

/**
 * Review shortcuts apply only to the desk itself: not while a dialog is open,
 * and not for keys pressed somewhere else in the app.
 */
function shortcutTarget(target: EventTarget | null): boolean {
  if (document.querySelector('[role=dialog]')) return false;
  if (isEditable(target)) return false;
  if (target === null || target === document.body || target === document.documentElement) return true;
  const desk = document.querySelector('.nb-desk');
  return target instanceof Node && desk !== null && desk.contains(target);
}

const READ_TOOLS = /^(read|list|search|get|find|open|view)/i;

function buildDiff(item: ReviewItem, view: View): ParsedDiff | null {
  const { data } = item.approval;
  const path = data.arguments.path ?? 'file';
  const content = typeof data.arguments.content === 'string' ? data.arguments.content : null;
  if (view === 'whole' && content !== null) return newFileDiff(path, content);
  const isNew = data.before_hash === null;
  if (typeof data.diff === 'string' && data.diff.trim() !== '') {
    const parsed = parseDiff(data.diff, { isNew, truncated: data.diff_truncated === true });
    const looksWrong = isNew && content !== null && content !== '' && parsed.added === 0;
    if (!looksWrong) return parsed;
  }
  if (isNew && content !== null) return newFileDiff(path, content);
  return null;
}

export function ReviewPane({ item, index, total, busy, onDecide, onNext, onClose, outcome, onExport }: Props) {
  const { approval } = item;
  const { data } = approval;
  const isRead = READ_TOOLS.test(data.tool) || (data.diff === undefined && data.arguments.content === undefined);
  const path = typeof data.arguments.path === 'string' ? data.arguments.path : null;
  const [view, setView] = useState<View>('changes');
  const hasContent = typeof data.arguments.content === 'string';
  const diff = useMemo(() => (isRead ? null : buildDiff(item, view)), [item, view, isRead]);

  const decidable = !outcome && !busy && approval.status === 'pending';
  useShortcut(
    (e) => isMod(e) && e.key === 'Enter' && shortcutTarget(e.target),
    (e) => {
      e.preventDefault();
      void onDecide('approve');
    },
    decidable,
  );
  useShortcut(
    (e) => isMod(e) && e.key === 'Backspace' && shortcutTarget(e.target),
    (e) => {
      e.preventDefault();
      void onDecide('reject');
    },
    decidable,
  );

  // Confirmations clear themselves; a failure stays until the person closes it.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const settledKind = outcome && !outcome.pending && outcome.kind !== 'failed' ? outcome.kind : null;
  useEffect(() => {
    if (!settledKind) return;
    const timer = window.setTimeout(() => closeRef.current(), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [settledKind]);

  const target = data.tool === 'computer_act' ? data.target : undefined;
  const allow = target ? 'Allow this action' : isRead ? 'Allow' : 'Apply change';
  const deny = isRead || target ? "Don't allow" : 'Reject change';
  const noun = isRead ? 'Request' : 'Change';

  return (
    <section className="nb-review-pane" aria-label="Review">
      <header className="nb-review-pane__head">
        <span className="nb-review-pane__count">
          {outcome ? 'Result' : `${noun} ${index + 1} of ${total}`}
        </span>
        <div className="nb-review-pane__head-actions">
          {total > 1 && !outcome ? (
            <Button variant="secondary" icon={ChevronRight} onClick={onNext}>
              Next
            </Button>
          ) : null}
          <IconButton label="Close review" icon={X} onClick={onClose} />
        </div>
      </header>

      {outcome ? (
        <div className="nb-review-pane__body">
          <div className="nb-review-pane__result" data-kind={outcome.kind}>
            {outcome.kind === 'applied' && outcome.pending ? (
              <p className="nb-review-pane__result-title" role="status">
                <StatusDot state="working" label="Working" size="sm" />
                Applying...
              </p>
            ) : outcome.kind === 'applied' ? (
              <p className="nb-review-pane__result-title" role="status">
                <Check className="nb-review-pane__result-icon" aria-hidden="true" />
                Changed {outcome.changed.length} {outcome.changed.length === 1 ? 'file' : 'files'}
              </p>
            ) : outcome.kind === 'rejected' ? (
              <p className="nb-review-pane__result-title" role="status">
                {isRead ? 'Not allowed. Nothing was read.' : 'Not changed. The file is as it was.'}
              </p>
            ) : (
              <p className="nb-review-pane__result-title" role="alert">
                That didn't go through
              </p>
            )}
            {outcome.kind === 'failed' ? (
              <p className="nb-review-pane__text">
                The file may have changed since the helper proposed this. Nothing was changed; ask the helper to try again.
              </p>
            ) : null}
            {outcome.kind === 'applied' && outcome.changed.length > 0 ? (
              <ul className="nb-review-pane__files">
                {outcome.changed.map((p) => (
                  <li key={p}>
                    <PathChip path={p} state="changed" />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="nb-review-pane__foot">
            {outcome.kind === 'applied' && !outcome.pending && outcome.backupArtifactId && onExport ? (
              <Button variant="secondary" icon={Download} onClick={() => onExport(outcome.backupArtifactId as string)}>
                Save earlier version...
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="nb-review-pane__body">
            <h2 className="nb-review-pane__title">{toolPhrase(data.tool, data.arguments, 'request')}</h2>
            {path && !isRead ? <PathChip path={path} state="proposed" /> : null}
            {target ? (
              <div className="nb-review-pane__target">
                <dl>
                  <dt>App</dt>
                  <dd>{target.app ?? 'The front app'}</dd>
                  {target.label ? (<><dt>{target.role ?? 'Item'}</dt><dd>{target.label}</dd></>) : null}
                  {target.text ? (<><dt>Types</dt><dd>{target.text}</dd></>) : null}
                  {target.key ? (<><dt>Key</dt><dd>{target.key}</dd></>) : null}
                </dl>
                {target.risk ? <p className="nb-review-pane__warn" role="note">Careful: this looks like it {target.risk}.</p> : null}
                <p className="nb-review-pane__text">Notbot reads this from the screen, not from the helper’s description. Control + Option + Esc stops everything.</p>
              </div>
            ) : isRead ? (
              <p className="nb-review-pane__text">
                {data.tool === 'web_search'
                  ? `Allow this helper to send the displayed query to ${data.provider ?? "Brave Search"}${data.provider === "SearXNG" && data.endpoint ? ` at ${data.endpoint}` : ""} once.`
                  : 'This helper asks before it reads. Allow it to read this once, or keep it out.'}
              </p>
            ) : diff ? (
              <>
                {hasContent ? (
                  <Segmented<View>
                    label="Show"
                    value={view}
                    options={[
                      { value: 'changes', label: 'Changes' },
                      { value: 'whole', label: 'Whole file' },
                    ]}
                    onChange={setView}
                  />
                ) : null}
                <DiffView diff={diff} />
              </>
            ) : (
              <p className="nb-review-pane__text">
                The exact lines can't be previewed for this one. You can still decide, and nothing changes until you apply it.
              </p>
            )}
          </div>
          <footer className="nb-review-pane__foot">
            <Button
              className="nb-review-pane__action"
              variant="secondary"
              tone="danger"
              shortcut={[modKey, '⌫']}
              disabled={busy}
              onClick={() => void onDecide('reject')}
            >
              {deny}
            </Button>
            <Button
              className="nb-review-pane__action"
              variant="primary"
              shortcut={[modKey, '↵']}
              loading={busy}
              disabled={busy}
              onClick={() => void onDecide('approve')}
            >
              {allow}
            </Button>
          </footer>
        </>
      )}
    </section>
  );
}
