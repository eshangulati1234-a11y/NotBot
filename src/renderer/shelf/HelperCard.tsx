import { HelperMark, StatusDot } from '../ui';
import { dotState, helperStateLabel } from '../lib/status';
import type { HelperView } from '../lib/helpers';
import './HelperCard.css';

export function HelperCard({ helper, onOpen }: { helper: HelperView; onOpen: () => void }) {
  const { bot, state, outcome } = helper;
  const label = helperStateLabel(state);
  return (
    <button type="button" className="nb-helper-card" data-state={state} onClick={onOpen}>
      <span className="nb-helper-card__head">
        <HelperMark name={bot.name} size={40} />
        <span className="nb-helper-card__who">
          <span className="nb-helper-card__name">{bot.name}</span>
        </span>
      </span>
      <span className="nb-helper-card__job">{bot.purpose}</span>
      <span className="nb-helper-card__boundary">reads freely · asks before changing</span>
      <span className="nb-helper-card__foot">
        <span className="nb-helper-card__state">
          <StatusDot state={dotState(state)} label={label} size="sm" />
          <span>{label}</span>
        </span>
        <span className="nb-helper-card__outcome">{outcome}</span>
      </span>
    </button>
  );
}
