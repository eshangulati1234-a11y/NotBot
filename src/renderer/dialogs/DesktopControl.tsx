import { useCallback, useEffect, useState } from 'react';
import { Check, Circle } from 'lucide-react';
import { Button } from '../ui';
import { request } from '../api';
import './DesktopControl.css';

export interface DesktopState {
  enabled: boolean;
  supported: boolean;
  installed: boolean;
  accessibility: boolean;
  screen: boolean;
  allow: string[];
  block: string[];
}

const split = (text: string) =>
  text
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

/** Settings → Desktop control: one switch, two permissions, and which apps are allowed. */
export function DesktopControl({ open }: { open: boolean }) {
  const [state, setState] = useState<DesktopState | null>(null);
  const [allow, setAllow] = useState('');
  const [block, setBlock] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await request<DesktopState>('GET', '/desktop');
      setState(data);
      setAllow(data.allow.join(', '));
      setBlock(data.block.join(', '));
    } catch {
      setError('Could not read the desktop settings.');
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const save = async (enabled: boolean) => {
    setBusy(true);
    setError('');
    try {
      setState(await request<DesktopState>('PUT', '/desktop', { enabled, allow: split(allow), block: split(block) }));
    } catch {
      setError('Pause or finish the running task first, then try again.');
    } finally {
      setBusy(false);
    }
  };

  const grant = async (pane: 'accessibility' | 'screen') => {
    await window.notbotRuntime?.openPrivacy(pane);
  };

  if (!state) return <p className="nb-desktop__text">{error || 'Checking…'}</p>;
  if (!state.supported)
    return <p className="nb-desktop__text">Desktop control is available on macOS only.</p>;
  if (!state.installed)
    return (
      <p className="nb-desktop__text">
        The desktop helper is not built yet. Run <code>npm run build:deskhand</code> and restart Notbot.
      </p>
    );

  const permission = (ok: boolean, label: string, pane: 'accessibility' | 'screen', why: string) => (
    <li className="nb-desktop__perm" data-ok={ok}>
      {ok ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
      <span className="nb-desktop__perm-text">
        <strong>{label}</strong>
        <span>{why}</span>
      </span>
      {ok ? null : (
        <Button variant="secondary" onClick={() => void grant(pane)}>
          Open settings
        </Button>
      )}
    </li>
  );

  return (
    <div className="nb-desktop">
      <p className="nb-desktop__text">
        Lets a helper you choose look at and use apps on this Mac. It reads freely, asks before every
        click, keystroke or app launch, and never touches password managers, Terminal or System
        Settings. Press Control + Option + Esc at any time to stop it.
      </p>
      <label className="nb-desktop__switch">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy}
          onChange={(event) => void save(event.target.checked)}
        />
        <span>Allow desktop control</span>
      </label>
      <ul className="nb-desktop__perms" aria-label="Permissions">
        {permission(state.accessibility, 'Accessibility', 'accessibility', 'Needed to read and click buttons and fields.')}
        {permission(state.screen, 'Screen Recording', 'screen', 'Only needed for screenshots. Reading the screen works without it.')}
      </ul>
      <p className="nb-desktop__text">
        After you grant a permission, quit and reopen Notbot so macOS applies it.
      </p>
      <label className="nb-desktop__field">
        <span>Only these apps (optional, comma separated)</span>
        <input className="nb-input" value={allow} onChange={(e) => setAllow(e.target.value)} placeholder="TextEdit, Notes" />
      </label>
      <label className="nb-desktop__field">
        <span>Never use these apps (added to the built-in list)</span>
        <input className="nb-input" value={block} onChange={(e) => setBlock(e.target.value)} placeholder="Mail, Messages" />
      </label>
      <div>
        <Button variant="secondary" loading={busy} onClick={() => void save(state.enabled)}>
          Save app lists
        </Button>
      </div>
      {error ? <p className="nb-desktop__error" role="alert">{error}</p> : null}
    </div>
  );
}
