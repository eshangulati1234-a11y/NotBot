import { useCallback, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button, Field, IconButton, useAutoGrow } from '../ui';
import { request, type BotMemory } from '../api';
import './HelperMemory.css';

interface Props {
  botId: string;
  learn: boolean;
  onLearnChange: (learn: boolean) => void;
}

const TARGET_LABEL = { user: 'About you', memory: 'About the work' } as const;

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export function HelperMemory({ botId, learn, onLearnChange }: Props) {
  const [data, setData] = useState<BotMemory | null>(null);
  const [memory, setMemory] = useState('');
  const [user, setUser] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const memoryRef = useAutoGrow(memory);
  const userRef = useAutoGrow(user);

  const apply = useCallback((next: BotMemory) => {
    setData(next);
    setMemory(next.memory.trim());
    setUser(next.user.trim());
  }, []);

  useEffect(() => {
    let current = true;
    request<BotMemory>('GET', `/bots/${botId}/memory`)
      .then((next) => current && apply(next))
      .catch((reason) => current && setError(message(reason)));
    return () => {
      current = false;
    };
  }, [botId, apply]);

  const caps = data?.caps ?? { memory: 2200, user: 1375 };
  const dirty = !!data && (memory !== data.memory.trim() || user !== data.user.trim());
  const over = memory.length > caps.memory || user.length > caps.user;

  const save = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      apply(await request<BotMemory>('PUT', `/bots/${botId}/memory`, { memory, user }));
      setSaved(true);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSaving(false);
    }
  };

  const decide = async (id: string, decision: 'accept' | 'dismiss') => {
    setError('');
    try {
      apply(await request<BotMemory>('POST', `/memory/proposals/${id}`, { decision }));
    } catch (reason) {
      setError(message(reason));
    }
  };

  return (
    <section className="nb-memory" aria-labelledby="nb-memory-h">
      <h3 id="nb-memory-h" className="nb-memory__heading">
        Memory
      </h3>
      <p className="nb-memory__lead">
        What this helper keeps in mind for every task. It stays on this computer, and you decide what is in it.
      </p>

      <label className="nb-memory__learn">
        <input type="checkbox" checked={learn} onChange={(event) => onLearnChange(event.target.checked)} />
        <span>Suggest things to remember after a task</span>
      </label>

      {data?.proposals.length ? (
        <ul className="nb-memory__proposals" aria-label="Suggested memories">
          {data.proposals.map((item) => (
            <li key={item.id} className="nb-memory__proposal">
              <div className="nb-memory__proposal-text">
                <span className="nb-memory__kicker">{TARGET_LABEL[item.target]}</span>
                <span>{item.text}</span>
              </div>
              <IconButton label="Remember this" icon={Check} onClick={() => void decide(item.id, 'accept')} />
              <IconButton label="Not now" icon={X} onClick={() => void decide(item.id, 'dismiss')} />
            </li>
          ))}
        </ul>
      ) : null}

      <Field label="About you" hint={`${user.length} of ${caps.user} characters. Preferences, like “keeps answers short”.`}>
        {(id, describedBy) => (
          <textarea
            id={id}
            aria-describedby={describedBy}
            className="nb-textarea"
            ref={userRef}
            rows={2}
            value={user}
            disabled={!data}
            onChange={(event) => setUser(event.target.value)}
          />
        )}
      </Field>
      <Field label="About the work" hint={`${memory.length} of ${caps.memory} characters. Lasting facts, like “uses pnpm”.`}>
        {(id, describedBy) => (
          <textarea
            id={id}
            aria-describedby={describedBy}
            className="nb-textarea"
            ref={memoryRef}
            rows={2}
            value={memory}
            disabled={!data}
            onChange={(event) => setMemory(event.target.value)}
          />
        )}
      </Field>

      <div className="nb-memory__foot">
        <Button variant="secondary" onClick={() => void save()} loading={saving} disabled={!dirty || over}>
          Save memory
        </Button>
        <span className="nb-memory__status" role="status" aria-live="polite">
          {over ? 'Too long to save. Shorten it first.' : saved && !dirty ? 'Saved' : ''}
        </span>
      </div>
      <p className="nb-memory__error" role="alert" data-empty={!error || undefined}>
        {error}
      </p>
    </section>
  );
}
