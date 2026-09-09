import './combat-screen.css';

export type CombatantSideView = 'PLAYER' | 'COMPANION' | 'HOSTILE' | 'NEUTRAL';

export interface CombatTimelineEntryViewModel {
  readonly combatantId: string;
  readonly displayNameZhCn: string;
  readonly isExtraTurn: boolean;
  readonly isCurrent: boolean;
}

export interface CombatantStageViewModel {
  readonly combatantId: string;
  readonly displayNameZhCn: string;
  readonly side: CombatantSideView;
  readonly sideLabelZhCn: string;
  readonly stateLabelZhCn: string;
  readonly isActiveTurn: boolean;
}

export interface CombatScreenShellViewModel {
  readonly combatInstanceId: string;
  readonly stateRevision: number;
  readonly phaseLabelZhCn: string;
  readonly roundLabelZhCn: string;
  readonly activeCombatantId: string | null;
  readonly timeline: readonly CombatTimelineEntryViewModel[];
  readonly combatants: readonly CombatantStageViewModel[];
}

export function CombatScreen({ viewModel }: { readonly viewModel: CombatScreenShellViewModel }) {
  const party = viewModel.combatants.filter(
    (combatant) => combatant.side === 'PLAYER' || combatant.side === 'COMPANION',
  );
  const hostiles = viewModel.combatants.filter((combatant) => combatant.side === 'HOSTILE');
  const neutral = viewModel.combatants.filter((combatant) => combatant.side === 'NEUTRAL');
  const activeName = viewModel.combatants.find(
    (combatant) => combatant.combatantId === viewModel.activeCombatantId,
  )?.displayNameZhCn;

  return (
    <main
      className="combat-screen"
      aria-label="战斗界面"
      data-combat-instance-id={viewModel.combatInstanceId}
      data-state-revision={viewModel.stateRevision}
    >
      <header className="combat-screen__header">
        <div>
          <p className="combat-screen__eyebrow">当前战斗</p>
          <h1>{viewModel.roundLabelZhCn}</h1>
        </div>
        <div className="combat-screen__phase" aria-live="polite" aria-atomic="true">
          <span>{viewModel.phaseLabelZhCn}</span>
          <strong>{activeName === undefined ? '等待下一步' : `轮到：${activeName}`}</strong>
        </div>
      </header>

      <TurnTimeline entries={viewModel.timeline} />

      <BattleStage party={party} hostiles={hostiles} neutral={neutral} />
    </main>
  );
}

export function TurnTimeline({
  entries,
}: {
  readonly entries: readonly CombatTimelineEntryViewModel[];
}) {
  return (
    <nav className="combat-timeline" aria-label="行动顺序">
      <ol>
        {entries.map((entry, index) => (
          <li
            key={`${entry.combatantId}:${entry.isExtraTurn ? 'extra' : 'normal'}:${String(index)}`}
            className={
              entry.isCurrent ? 'combat-timeline__entry is-current' : 'combat-timeline__entry'
            }
            aria-current={entry.isCurrent ? 'step' : undefined}
            data-combatant-id={entry.combatantId}
          >
            <span className="combat-timeline__order" aria-hidden="true">
              {index + 1}
            </span>
            <span className="combat-timeline__name">{entry.displayNameZhCn}</span>
            {entry.isExtraTurn ? <small>额外回合</small> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function BattleStage({
  party,
  hostiles,
  neutral,
}: {
  readonly party: readonly CombatantStageViewModel[];
  readonly hostiles: readonly CombatantStageViewModel[];
  readonly neutral: readonly CombatantStageViewModel[];
}) {
  return (
    <section className="battle-stage" aria-label="战斗场景">
      <CombatantGroup className="battle-stage__party" label="我方队伍" combatants={party} />
      <div className="battle-stage__focus" aria-hidden="true">
        <span />
        <strong>交战区域</strong>
        <span />
      </div>
      <CombatantGroup className="battle-stage__hostiles" label="敌方队伍" combatants={hostiles} />
      {neutral.length > 0 ? (
        <CombatantGroup className="battle-stage__neutral" label="中立单位" combatants={neutral} />
      ) : null}
    </section>
  );
}

function CombatantGroup({
  className,
  label,
  combatants,
}: {
  readonly className: string;
  readonly label: string;
  readonly combatants: readonly CombatantStageViewModel[];
}) {
  return (
    <section className={`combatant-group ${className}`} aria-label={label}>
      <h2>{label}</h2>
      <div className="combatant-group__roster">
        {combatants.map((combatant) => (
          <CombatantView key={combatant.combatantId} combatant={combatant} />
        ))}
      </div>
    </section>
  );
}

export function CombatantView({ combatant }: { readonly combatant: CombatantStageViewModel }) {
  return (
    <article
      className={`combatant-view combatant-view--${combatant.side.toLowerCase()}${combatant.isActiveTurn ? ' is-active' : ''}`}
      aria-label={`${combatant.displayNameZhCn}，${combatant.sideLabelZhCn}，${combatant.stateLabelZhCn}`}
      aria-current={combatant.isActiveTurn ? 'true' : undefined}
      data-combatant-id={combatant.combatantId}
    >
      <div className="combatant-view__portrait" aria-hidden="true">
        {firstVisibleCharacter(combatant.displayNameZhCn)}
      </div>
      <div className="combatant-view__identity">
        <strong>{combatant.displayNameZhCn}</strong>
        <span>{combatant.sideLabelZhCn}</span>
      </div>
      <span className="combatant-view__state">{combatant.stateLabelZhCn}</span>
    </article>
  );
}

function firstVisibleCharacter(value: string): string {
  return Array.from(value.trim())[0] ?? '·';
}
