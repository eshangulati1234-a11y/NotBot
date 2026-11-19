import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Dialog, HelperMark } from '../ui';
import type { HelperView } from '../lib/helpers';
import './CommandBar.css';

interface CommandBarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  helpers: HelperView[];
  /** Asking starts a task, so it needs a ready model. */
  modelReady: boolean;
  onAsk: (botId: string, text: string) => void;
  onNewHelper: (text: string) => void;
  onOpenHelper: (botId: string) => void;
  onAddFolder: () => void;
  onChangeModel: () => void;
  onOpenSettings: () => void;
}

interface Command {
  id: string;
  label: string;
  hint?: string;
  mark?: string;
  disabled?: boolean;
  run: () => void;
}

function CommandList(props: Omit<CommandBarProps, 'open'>) {
  const { helpers, modelReady, onOpenChange, onAsk, onNewHelper, onOpenHelper, onAddFolder, onChangeModel, onOpenSettings } =
    props;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const text = query.trim();
  const needle = text.toLowerCase();

  const commands = useMemo(() => {
    const done = (fn: () => void) => () => {
      onOpenChange(false);
      fn();
    };
    const list: Command[] = [];
    for (const h of helpers) {
      if (!needle || `${h.bot.name} ${h.bot.purpose}`.toLowerCase().includes(needle)) {
        list.push({ id: `open-${h.bot.id}`, label: `Open ${h.bot.name}`, hint: h.bot.purpose, mark: h.bot.name, run: done(() => onOpenHelper(h.bot.id)) });
      }
    }
    if (text && !modelReady) {
      list.push({
        id: 'ask-unavailable',
        label: `Ask a helper: ${text}`,
        hint: 'Needs a model first',
        disabled: true,
        run: () => undefined,
      });
    } else if (text) {
      for (const h of helpers) {
        if (h.state === 'off' || h.activeRun) continue;
        list.push({ id: `ask-${h.bot.id}`, label: `Ask ${h.bot.name}: ${text}`, hint: 'Starts a task', mark: h.bot.name, run: done(() => onAsk(h.bot.id, text)) });
      }
      list.push({ id: 'new-with', label: `New helper: ${text}`, hint: 'Uses this as its job', run: done(() => onNewHelper(text)) });
    }
    const actions: Command[] = [
      { id: 'new', label: 'New helper', run: done(() => onNewHelper('')) },
      { id: 'folder', label: 'Add a folder', run: done(onAddFolder) },
      { id: 'model', label: 'Change model', run: done(onChangeModel) },
      { id: 'settings', label: 'Open settings', run: done(onOpenSettings) },
    ];
    for (const a of actions) if (!needle || a.label.toLowerCase().includes(needle)) list.push(a);
    return list;
  }, [helpers, modelReady, needle, text, onOpenChange, onAsk, onNewHelper, onOpenHelper, onAddFolder, onChangeModel, onOpenSettings]);

  const current = Math.min(active, Math.max(commands.length - 1, 0));
  const optionId = (index: number) => `${listId}-${index}`;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current + 1) % Math.max(commands.length, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current - 1 + commands.length) % Math.max(commands.length, 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!commands[current]?.disabled) commands[current]?.run();
    }
  };

  return (
    <div className="nb-command-bar">
      <input
        className="nb-command-bar__input"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={commands.length ? optionId(current) : undefined}
        aria-label="Type a task, a helper or an action"
        placeholder="Type a task, or find a helper or action"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        autoFocus
        spellCheck={false}
      />
      <ul className="nb-command-bar__list" id={listId} role="listbox" aria-label="Results">
        {commands.map((command, index) => (
          <li
            key={command.id}
            id={optionId(index)}
            role="option"
            aria-selected={index === current}
            aria-disabled={command.disabled || undefined}
            className="nb-command-bar__option"
            data-active={index === current}
            data-disabled={command.disabled || undefined}
            onMouseMove={() => setActive(index)}
            onClick={command.disabled ? undefined : command.run}
          >
            {command.mark ? <HelperMark name={command.mark} size={20} /> : <span className="nb-command-bar__gap" />}
            <span className="nb-command-bar__label">{command.label}</span>
            {command.hint ? <span className="nb-command-bar__hint">{command.hint}</span> : null}
          </li>
        ))}
        {commands.length === 0 ? <li className="nb-command-bar__empty">Nothing matches. Try other words.</li> : null}
      </ul>
    </div>
  );
}

export function CommandBar({ open, onOpenChange, ...rest }: CommandBarProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Search or ask" size="md">
      {open ? <CommandList {...rest} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}
