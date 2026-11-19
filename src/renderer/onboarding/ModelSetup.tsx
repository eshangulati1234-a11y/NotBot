import { useState } from 'react';
import { Button, Field, Segmented } from '../ui';
import { LMSTUDIO_URL, OLLAMA_URL } from '../api';
import { deviceName } from '../lib/keys';
import type { Notbot } from '../useNotbot';

type ModelState = Notbot['model'];
import './ModelSetup.css';

type Provider = 'ollama' | 'lmstudio' | 'custom';

interface ModelSetupProps {
  model: ModelState;
  onDiscover: (url: string) => Promise<string[]>;
  onSave: (url: string, model: string) => Promise<boolean>;
  onRetry: () => void;
}

const providerOptions: { value: Provider; label: string }[] = [
  { value: 'ollama', label: 'Ollama' },
  { value: 'lmstudio', label: 'LM Studio' },
  { value: 'custom', label: 'Custom' },
];

function initialProvider(url: string): Provider {
  if (!url) return 'ollama';
  if (url.includes(':11434')) return 'ollama';
  if (url.includes(':1234')) return 'lmstudio';
  return 'custom';
}

function explain(model: ModelState): { title: string; body: string } | null {
  switch (model.status) {
    case 'checking':
      return { title: `Looking for a model on ${deviceName}…`, body: '' };
    case 'no-server':
      return {
        title: `Notbot can’t find a model on ${deviceName}`,
        body: 'Helpers think with a model that runs on your computer. Nothing is sent anywhere.',
      };
    case 'no-models':
      return {
        title: 'The model server has no models yet',
        body: 'It is running, but nothing is installed for Notbot to use.',
      };
    case 'missing-model':
      return {
        title: 'The chosen model isn’t installed',
        body: 'Pick one of the models below, or install the one you wanted.',
      };
    default:
      return null;
  }
}

function NextStep({ provider }: { provider: Provider }) {
  if (provider === 'ollama') {
    return (
      <p className="nb-model-setup__step">
        Open Ollama, then in Terminal run <code className="nb-model-setup__code">ollama pull llama3.2:3b</code>.
      </p>
    );
  }
  if (provider === 'lmstudio') {
    return (
      <p className="nb-model-setup__step">
        Open LM Studio, load a model and start its local server.
      </p>
    );
  }
  return (
    <p className="nb-model-setup__step">
      Enter the address of a model server running on {deviceName}, then find its models.
    </p>
  );
}

export function ModelSetup({ model, onDiscover, onSave, onRetry }: ModelSetupProps) {
  const [provider, setProvider] = useState<Provider>(initialProvider(model.baseUrl));
  const [custom, setCustom] = useState(initialProvider(model.baseUrl) === 'custom' ? model.baseUrl : '');
  const [models, setModels] = useState<string[]>(model.models);
  const [chosen, setChosen] = useState(model.model);
  const [finding, setFinding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const url = provider === 'ollama' ? OLLAMA_URL : provider === 'lmstudio' ? LMSTUDIO_URL : custom.trim();
  const note = explain(model);

  const find = async () => {
    setFinding(true);
    setError('');
    setSaved(false);
    try {
      const found = await onDiscover(url);
      setModels(found);
      if (found.length && !found.includes(chosen)) setChosen(found[0]);
      if (!found.length) setError('That server is running but has no models installed yet.');
    } catch (reason) {
      setModels([]);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setFinding(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      setSaved(await onSave(url, chosen));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="nb-model-setup">
      {note ? (
        <div className="nb-model-setup__note">
          <p className="nb-model-setup__title">{note.title}</p>
          {note.body ? <p className="nb-model-setup__text">{note.body}</p> : null}
        </div>
      ) : null}
      <Segmented<Provider>
        label="Where the model runs"
        value={provider}
        options={providerOptions}
        onChange={(value) => {
          setProvider(value);
          setModels([]);
          setError('');
          setSaved(false);
        }}
      />
      {model.status === 'ready' ? null : <NextStep provider={provider} />}
      {provider === 'custom' ? (
        <Field label="Server address" hint="For example http://127.0.0.1:8080/v1">
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              className="nb-input"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              spellCheck={false}
            />
          )}
        </Field>
      ) : null}
      <div className="nb-model-setup__row">
        <Button variant="secondary" onClick={find} loading={finding} disabled={!url}>
          Find models
        </Button>
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
      {error ? (
        <p className="nb-model-setup__error" role="alert">
          {error}
        </p>
      ) : null}
      {models.length ? (
        <div className="nb-model-setup__pick">
          <Field label="Model">
            {(id, describedBy) => (
              <select
                id={id}
                aria-describedby={describedBy}
                className="nb-select"
                value={chosen}
                onChange={(event) => {
                  setChosen(event.target.value);
                  setSaved(false);
                }}
              >
                {models.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="nb-model-setup__row">
            <Button variant="primary" onClick={save} loading={saving} disabled={!chosen || !url}>
              Use this model
            </Button>
            {saved ? <span className="nb-model-setup__saved">Saved</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
