import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, Check, ChevronDown, ChevronRight, Download, Eye, ListChecks } from 'lucide-react';
import type { Run } from '../api';
import { finished } from '../api';
import type { TaskView, TrailStep } from '../lib/trail';
import { explainError, runStatusLabel } from '../lib/status';
import { Button, EmptyState, IconButton, PathChip, StatusDot } from '../ui';
import { Markdown } from './markdown';
import './Trail.css';

interface Props {
  tasks: TaskView[];
  liveText: string;
  activeRun: Run | null;
  knownPaths: string[];
  focusApprovalId: string | null;
  onReview: (approvalId: string) => void;
  onExport: (artifactId: string) => void;
  onPreview: (artifactId: string) => void;
}

const STICK_DISTANCE = 48;
const READ_TOOLS = /^(read|list|search|get|find|open|view)/i;

interface StepProps {
  step: TrailStep;
  focused: boolean;
  /** True for the newest task, whose failure is announced once. */
  live: boolean;
  onReview: (id: string) => void;
  onExport: (id: string) => void;
}

function Step({ step, focused, live, onReview, onExport }: StepProps) {
  if (step.kind === 'note') {
    return <li className="nb-trail__step nb-trail__step--note">{step.text}</li>;
  }
  if (step.kind === 'end') {
    if (step.tone === 'failed') {
      const why = explainError(step.text);
      return (
        <li className="nb-trail__step nb-trail__callout" data-tone="failed" role={live ? 'status' : undefined}>
          <AlertTriangle className="nb-trail__callout-icon" aria-hidden="true" />
          <div className="nb-trail__callout-body">
            <strong className="nb-trail__callout-title">{why.title}</strong>
            <span>{why.next}</span>
          </div>
        </li>
      );
    }
    return (
      <li className="nb-trail__step nb-trail__step--end" data-tone={step.tone}>
        {step.tone === 'done' ? <Check className="nb-trail__icon" aria-hidden="true" /> : null}
        <span>{step.text}</span>
      </li>
    );
  }
  if (step.kind === 'tool') {
    return (
      <li className="nb-trail__step" data-state={step.state}>
        <span className="nb-trail__marker">
          {step.state === 'running' ? (
            <StatusDot state="working" label="Working" size="sm" />
          ) : step.state === 'error' ? (
            <AlertTriangle className="nb-trail__icon nb-trail__icon--bad" aria-hidden="true" />
          ) : (
            <Check className="nb-trail__icon" aria-hidden="true" />
          )}
        </span>
        <span className="nb-trail__label">{step.label}</span>
        {step.paths.map((p) => (
          <PathChip key={p} path={p} state="read" />
        ))}
      </li>
    );
  }
  // review step
  const read = READ_TOOLS.test(step.tool);
  const verb =
    step.state === 'pending'
      ? read
        ? 'Wants to read'
        : 'Wants to change'
      : step.state === 'applying'
        ? 'Applying the change to'
        : step.state === 'applied'
          ? read
            ? 'Read'
            : 'Changed'
          : step.state === 'rejected'
            ? read
              ? "You didn't allow reading"
              : "You didn't allow a change to"
            : 'This request expired for';
  return (
    <li className="nb-trail__step nb-trail__step--review" data-state={step.state} data-focused={focused || undefined}>
      <span className="nb-trail__marker">
        {step.state === 'pending' ? (
          <StatusDot state="waiting" label="Waiting for you" size="sm" />
        ) : step.state === 'applying' ? (
          <StatusDot state="working" label="Working" size="sm" />
        ) : step.state === 'applied' ? (
          <Check className="nb-trail__icon" aria-hidden="true" />
        ) : (
          <StatusDot state="idle" label="Not applied" size="sm" />
        )}
      </span>
      <span className="nb-trail__label">{verb}</span>
      {step.path ? (
        <PathChip path={step.path} state={step.state === 'applied' ? 'changed' : step.state === 'pending' ? 'proposed' : 'seen'} />
      ) : null}
      {step.state === 'pending' ? (
        <Button variant="primary" icon={Eye} onClick={() => onReview(step.approvalId)}>
          Review
        </Button>
      ) : null}
      {step.state === 'applied' && step.backupArtifactId ? (
        <Button
          variant="secondary"
          icon={Download}
          onClick={() => onExport(step.backupArtifactId as string)}
        >
          Save earlier version...
        </Button>
      ) : null}
    </li>
  );
}

interface BlockProps {
  task: TaskView;
  compact: boolean;
  active: boolean;
  liveText: string;
  knownPaths: string[];
  focusApprovalId: string | null;
  onReview: (id: string) => void;
  onExport: (id: string) => void;
  onPreview: (id: string) => void;
}

function TaskBlock(props: BlockProps) {
  const { task, compact, active, liveText, knownPaths, focusApprovalId, onReview, onExport, onPreview } = props;
  const [open, setOpen] = useState(!compact);
  const run = task.run;
  const hasEnd = task.steps.some((s) => s.kind === 'end');
  const needsFresh = run?.status === 'needs_review';
  const failedNoStep = run?.status === 'failed' && !hasEnd;
  const status = run ? runStatusLabel(run.status) : '';
  const live = !compact;
  // A changed file that already has an applied review step is shown there; only list the rest.
  const reviewed = new Set(task.steps.flatMap((s) => (s.kind === 'review' && s.state === 'applied' && s.path ? [s.path] : [])));
  const unlisted = task.changed.filter((p) => !reviewed.has(p));

  return (
    <article className="nb-trail__task" data-compact={compact || undefined} aria-busy={active || undefined}>
      {compact ? (
        <button
          type="button"
          className="nb-trail__toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? (
            <ChevronDown className="nb-trail__icon" aria-hidden="true" />
          ) : (
            <ChevronRight className="nb-trail__icon" aria-hidden="true" />
          )}
          <span className="nb-trail__toggle-text">{task.task}</span>
          <span className="nb-trail__aside">{status}</span>
        </button>
      ) : (
        <header className="nb-trail__ask">
          <span className="nb-trail__kicker">Task</span>
          <p className="nb-trail__ask-text">{task.task}</p>
        </header>
      )}
      {open ? (
        <div className="nb-trail__work">
          {compact ? <p className="nb-trail__ask-text">{task.task}</p> : null}
          {task.steps.length > 0 ? (
            <ol className="nb-trail__steps">
              {task.steps.map((step) => (
                <Step
                  key={step.id}
                  step={step}
                  focused={step.kind === 'review' && step.approvalId === focusApprovalId}
                  live={live}
                  onReview={onReview}
                  onExport={onExport}
                />
              ))}
            </ol>
          ) : null}
          {active && task.steps.length === 0 && task.answer === '' && liveText ? (
            <p className="nb-trail__pending" aria-hidden="true">
              <StatusDot state="working" label="Working" size="sm" />
              {liveText}
            </p>
          ) : null}
          {task.answer ? (
            <div className="nb-trail__reply" data-streaming={task.streaming || undefined}>
              <Markdown text={task.answer} known={knownPaths} />
              {task.answerArtifactId ? (
                <div className="nb-trail__actions">
                  <IconButton
                    label="Open saved result"
                    icon={ListChecks}
                    onClick={() => onPreview(task.answerArtifactId as string)}
                  />
                  <IconButton
                    label="Save a copy..."
                    icon={Download}
                    onClick={() => onExport(task.answerArtifactId as string)}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          {needsFresh ? (
            <div className="nb-trail__callout" data-tone="warn" role={live ? 'status' : undefined}>
              <AlertTriangle className="nb-trail__callout-icon" aria-hidden="true" />
              <div className="nb-trail__callout-body">
                <strong className="nb-trail__callout-title">This task needs a fresh start</strong>
                <span>
                  The change it proposed ran out of time or the file changed meanwhile. Nothing was changed. Cancel this task below, then send it again.
                </span>
              </div>
            </div>
          ) : null}
          {failedNoStep && run ? (
            <div className="nb-trail__callout" data-tone="failed" role={live ? 'status' : undefined}>
              <AlertTriangle className="nb-trail__callout-icon" aria-hidden="true" />
              <div className="nb-trail__callout-body">
                <strong className="nb-trail__callout-title">{explainError(run.error ?? '').title}</strong>
                <span>{explainError(run.error ?? '').next}</span>
              </div>
            </div>
          ) : null}
          {unlisted.length > 0 ? (
            <div className="nb-trail__changed">
              <span className="nb-trail__kicker">
                Changed {unlisted.length} {unlisted.length === 1 ? 'file' : 'files'}
              </span>
              <div className="nb-trail__row">
                {unlisted.map((p) => (
                  <PathChip key={p} path={p} state="changed" />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function Trail(props: Props) {
  const { tasks, liveText, activeRun, knownPaths, focusApprovalId, onReview, onExport, onPreview } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [away, setAway] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const older = tasks.slice(0, -1);
  const latest = tasks.at(-1);
  const signature = tasks
    .map((t) => `${t.id}:${t.steps.length}:${t.answer.length}:${t.run?.status ?? ''}`)
    .join('|');

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const nearEnd = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_DISTANCE;
    stuck.current = nearEnd;
    setAway(!nearEnd);
  }

  function toEnd() {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stuck.current = true;
    setAway(false);
  }

  useLayoutEffect(() => {
    if (stuck.current) {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [signature, liveText, showHistory]);

  // A newly sent task always brings the view back to the bottom.
  const latestId = latest?.id;
  useEffect(() => {
    toEnd();
  }, [latestId]);

  const active = (id: string | undefined) => !!id && !!activeRun && !finished.includes(activeRun.status) && latest?.run?.id === activeRun.id;

  return (
    <div className="nb-trail">
      <div className="nb-trail__scroll" ref={scroller} onScroll={onScroll} tabIndex={0} role="region" aria-label="Activity">
        <div className="nb-trail__column">
          {tasks.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No tasks yet"
              body="Describe a task below. Each step the helper takes shows up here as it happens, and changes wait for your approval."
            />
          ) : null}
          {older.length > 0 ? (
            <section className="nb-trail__history">
              <button
                type="button"
                className="nb-trail__toggle nb-trail__toggle--history"
                aria-expanded={showHistory}
                onClick={() => setShowHistory((v) => !v)}
              >
                {showHistory ? (
                  <ChevronDown className="nb-trail__icon" aria-hidden="true" />
                ) : (
                  <ChevronRight className="nb-trail__icon" aria-hidden="true" />
                )}
                <span className="nb-trail__toggle-text">
                  Earlier tasks ({older.length})
                </span>
              </button>
              {showHistory
                ? older.map((t) => (
                    <TaskBlock
                      key={t.id}
                      task={t}
                      compact
                      active={false}
                      liveText=""
                      knownPaths={knownPaths}
                      focusApprovalId={focusApprovalId}
                      onReview={onReview}
                      onExport={onExport}
                      onPreview={onPreview}
                    />
                  ))
                : null}
            </section>
          ) : null}
          {latest ? (
            <TaskBlock
              key={latest.id}
              task={latest}
              compact={false}
              active={active(latest.id)}
              liveText={liveText}
              knownPaths={knownPaths}
              focusApprovalId={focusApprovalId}
              onReview={onReview}
              onExport={onExport}
              onPreview={onPreview}
            />
          ) : null}
        </div>
      </div>
      {away ? (
        <div className="nb-trail__jump">
          <Button variant="secondary" icon={ArrowDown} onClick={toEnd}>
            Jump to latest
          </Button>
        </div>
      ) : null}
    </div>
  );
}
