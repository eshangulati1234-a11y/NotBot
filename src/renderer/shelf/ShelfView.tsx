import { Plus } from 'lucide-react';
import { Button, EmptyState } from '../ui';
import { deviceName } from '../lib/keys';
import { groupByFolder, type HelperView } from '../lib/helpers';
import { HelperCard } from './HelperCard';
import './ShelfView.css';

interface ShelfViewProps {
  helpers: HelperView[];
  onOpen: (botId: string) => void;
  onNewHelper: () => void;
}

function summary(helpers: HelperView[]): string {
  const waiting = helpers.filter((h) => h.state === 'waiting').length;
  const working = helpers.filter((h) => h.state === 'working').length;
  const parts: string[] = [];
  if (waiting) parts.push(`${waiting} waiting for you`);
  if (working) parts.push(`${working} working`);
  return parts.length ? parts.join(' · ') : 'Everything is quiet. Open a helper to give it a task.';
}

export function ShelfView({ helpers, onOpen, onNewHelper }: ShelfViewProps) {
  return (
    <section className="nb-shelf-view" aria-labelledby="nb-shelf-title">
      <div className="nb-shelf-view__inner">
        <header className="nb-shelf-view__head">
          <div className="nb-shelf-view__titles">
            <h1 id="nb-shelf-title" className="nb-shelf-view__title">
              Your helpers
            </h1>
            <p className="nb-shelf-view__sub">{summary(helpers)}</p>
          </div>
          <Button variant="primary" icon={Plus} onClick={onNewHelper}>
            New helper
          </Button>
        </header>
        {helpers.length === 0 ? (
          <EmptyState
            title="No helpers yet"
            body={`A helper has one job and works in one folder on ${deviceName}. It asks before changing anything.`}
            action={
              <Button variant="primary" icon={Plus} onClick={onNewHelper}>
                New helper
              </Button>
            }
          />
        ) : (
          groupByFolder(helpers).map((group) => (
            <section key={group.key} className="nb-shelf-view__group" aria-labelledby={`nb-shelf-folder-${group.key || 'none'}`}>
              <h2
                id={`nb-shelf-folder-${group.key || 'none'}`}
                className="nb-shelf-view__folder"
                data-empty={group.path ? undefined : true}
                title={group.path || undefined}
              >
                {group.name}
              </h2>
              <ul className="nb-shelf-view__grid">
                {group.helpers.map((helper) => (
                  <li key={helper.bot.id} className="nb-shelf-view__item">
                    <HelperCard helper={helper} onOpen={() => onOpen(helper.bot.id)} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </section>
  );
}
