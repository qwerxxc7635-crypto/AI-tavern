import { useId } from 'react';

import type {
  CombatCommandEnvelope,
  CombatCommandPayload,
  CombatVersionSet,
} from '@ember-tavern/contracts';

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
  readonly health: CombatMeterViewModel;
  readonly shield: CombatMeterViewModel;
  readonly actionPoints: CombatMeterViewModel;
  readonly reactionCharges: CombatMeterViewModel;
  readonly resources: readonly CombatResourceViewModel[];
  readonly statuses: readonly CombatStatusViewModel[];
}

export interface CombatMeterViewModel {
  readonly current: number;
  readonly maximum: number;
  readonly textZhCn: string;
}

export interface CombatResourceViewModel {
  readonly resourceId: string;
  readonly labelZhCn: string;
  readonly current: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly overheatThreshold: number | null;
  readonly isOverheated: boolean;
  readonly textZhCn: string;
}

export interface CombatStatusViewModel {
  readonly statusInstanceId: string;
  readonly statusDefinitionId: string;
  readonly displayNameZhCn: string;
  readonly stackCount: number;
  readonly remainingDuration: number | null;
}

export type CombatActionViewKind = 'ABILITY' | 'END_TURN' | 'ESCAPE' | 'REACTION';

export interface CombatAbilityUsageViewModel {
  readonly cooldownRemaining: number;
  readonly usesThisNormalOwnerTurn: number;
  readonly maxUsesPerNormalOwnerTurn: number | null;
  readonly usesThisBattle: number;
  readonly maxUsesPerBattle: number | null;
}

export interface CombatActionViewModel {
  readonly actionId: string;
  readonly displayNameZhCn: string;
  readonly kind: CombatActionViewKind;
  readonly enabled: boolean;
  readonly legalTargetIds: readonly string[];
  readonly disabledReasonsZhCn: readonly string[];
  readonly abilityUsage: CombatAbilityUsageViewModel | null;
}

export interface CombatScreenShellViewModel {
  readonly combatInstanceId: string;
  readonly versions: CombatVersionSet;
  readonly stateRevision: number;
  readonly phaseLabelZhCn: string;
  readonly roundLabelZhCn: string;
  readonly activeCombatantId: string | null;
  readonly timeline: readonly CombatTimelineEntryViewModel[];
  readonly combatants: readonly CombatantStageViewModel[];
  readonly actions: readonly CombatActionViewModel[];
}

export interface CombatCommandPort {
  readonly createCommand: (payload: CombatCommandPayload) => CombatCommandEnvelope;
  readonly submitCommand: (command: CombatCommandEnvelope) => void;
  readonly onAbilitySelected: (actionId: string) => void;
}

export function CombatScreen({
  viewModel,
  commandPort,
}: {
  readonly viewModel: CombatScreenShellViewModel;
  readonly commandPort: CombatCommandPort;
}) {
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

      {activeName === undefined ? null : (
        <CharacterHUD
          combatant={requiredCombatant(viewModel.combatants, viewModel.activeCombatantId)}
        />
      )}

      <ActionBar actions={viewModel.actions} commandPort={commandPort} />
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

export function CharacterHUD({ combatant }: { readonly combatant: CombatantStageViewModel }) {
  return (
    <section className="character-hud" aria-label={`${combatant.displayNameZhCn}的战斗状态`}>
      <div className="character-hud__identity">
        <span>{combatant.sideLabelZhCn}</span>
        <h2>{combatant.displayNameZhCn}</h2>
        <strong>{combatant.stateLabelZhCn}</strong>
      </div>
      <div className="character-hud__vitals" aria-label="生命与护盾">
        <Meter label="生命" meter={combatant.health} tone="health" />
        {combatant.shield.maximum > 0 ? (
          <Meter label="护盾" meter={combatant.shield} tone="shield" />
        ) : null}
      </div>
      <ActionEconomy
        actionPoints={combatant.actionPoints}
        reactionCharges={combatant.reactionCharges}
      />
      <ResourceHUD resources={combatant.resources} />
      <StatusStrip statuses={combatant.statuses} />
    </section>
  );
}

export function ActionBar({
  actions,
  commandPort,
}: {
  readonly actions: readonly CombatActionViewModel[];
  readonly commandPort: CombatCommandPort;
}) {
  const abilities = actions.filter((action) => action.kind === 'ABILITY');
  const endTurn = actions.find((action) => action.kind === 'END_TURN');
  return (
    <section className="action-bar" aria-label="战斗行动">
      <div className="action-bar__abilities" role="group" aria-label="技能">
        {abilities.map((action) => (
          <AbilitySlot
            key={action.actionId}
            action={action}
            onSelected={commandPort.onAbilitySelected}
          />
        ))}
      </div>
      {endTurn === undefined ? null : (
        <button
          type="button"
          className="action-bar__end-turn"
          disabled={!endTurn.enabled}
          aria-label={endTurn.displayNameZhCn}
          onClick={() => {
            commandPort.submitCommand(commandPort.createCommand({ kind: 'END_TURN' }));
          }}
        >
          <strong>{endTurn.displayNameZhCn}</strong>
          <span>{endTurn.enabled ? '结束当前回合' : endTurn.disabledReasonsZhCn.join('；')}</span>
        </button>
      )}
    </section>
  );
}

export function AbilitySlot({
  action,
  onSelected,
}: {
  readonly action: CombatActionViewModel;
  readonly onSelected: (actionId: string) => void;
}) {
  const reasonId = useId();
  if (action.kind !== 'ABILITY' || action.abilityUsage === null) {
    throw new Error('AbilitySlot requires an ability action');
  }
  const usage = action.abilityUsage;
  const usageLines = abilityUsageLines(usage);
  return (
    <div className="ability-slot" data-action-id={action.actionId}>
      <button
        type="button"
        disabled={!action.enabled}
        aria-label={action.displayNameZhCn}
        aria-describedby={action.enabled ? undefined : reasonId}
        onClick={() => {
          onSelected(action.actionId);
        }}
      >
        <strong>{action.displayNameZhCn}</strong>
        <span>{usage.cooldownRemaining > 0 ? `冷却 ${usage.cooldownRemaining}` : '可以使用'}</span>
      </button>
      <div className="ability-slot__usage" aria-label={`${action.displayNameZhCn}使用情况`}>
        {usageLines.map((line) => (
          <small key={line}>{line}</small>
        ))}
      </div>
      {action.enabled ? null : (
        <ul id={reasonId} className="ability-slot__reasons">
          {action.disabledReasonsZhCn.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function abilityUsageLines(usage: CombatAbilityUsageViewModel): string[] {
  const lines: string[] = [];
  if (usage.maxUsesPerNormalOwnerTurn !== null) {
    lines.push(`本回合 ${usage.usesThisNormalOwnerTurn}/${usage.maxUsesPerNormalOwnerTurn}`);
  }
  if (usage.maxUsesPerBattle !== null) {
    lines.push(`本场 ${usage.usesThisBattle}/${usage.maxUsesPerBattle}`);
  }
  return lines;
}

export function ResourceHUD({
  resources,
}: {
  readonly resources: readonly CombatResourceViewModel[];
}) {
  return (
    <section className="resource-hud" aria-label="世界资源">
      <h3>资源</h3>
      {resources.length === 0 ? (
        <p className="resource-hud__empty">无额外资源</p>
      ) : (
        <ul>
          {resources.map((resource) => (
            <li
              key={resource.resourceId}
              className={
                resource.isOverheated ? 'resource-hud__item is-overheated' : 'resource-hud__item'
              }
              data-resource-id={resource.resourceId}
              data-overheated={resource.isOverheated ? 'true' : 'false'}
            >
              <div>
                <strong>{resource.labelZhCn}</strong>
                <span>{resource.textZhCn}</span>
              </div>
              <MeterTrack
                current={resource.current}
                minimum={resource.minimum}
                maximum={resource.maximum}
                label={resource.textZhCn}
              />
              {resource.overheatThreshold === null ? null : (
                <small>过热阈值：{resource.overheatThreshold}</small>
              )}
              {resource.isOverheated ? <em>已过热</em> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function StatusStrip({ statuses }: { readonly statuses: readonly CombatStatusViewModel[] }) {
  return (
    <section className="status-strip" aria-label="当前状态">
      <h3>状态</h3>
      {statuses.length === 0 ? (
        <p className="status-strip__empty">无状态</p>
      ) : (
        <ul>
          {statuses.map((status) => (
            <li key={status.statusInstanceId} data-status-id={status.statusDefinitionId}>
              <strong>{status.displayNameZhCn}</strong>
              {status.stackCount > 1 ? <span>{status.stackCount} 层</span> : null}
              {status.remainingDuration === null ? (
                <span>持续生效</span>
              ) : (
                <span>剩余 {status.remainingDuration} 次计时</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActionEconomy({
  actionPoints,
  reactionCharges,
}: {
  readonly actionPoints: CombatMeterViewModel;
  readonly reactionCharges: CombatMeterViewModel;
}) {
  const visiblePips = Math.min(actionPoints.maximum, 12);
  return (
    <section className="action-economy" aria-label="行动经济">
      <h3>行动点</h3>
      <div
        className="action-economy__pips"
        aria-label={actionPoints.textZhCn}
        data-current={actionPoints.current}
        data-maximum={actionPoints.maximum}
      >
        {Array.from({ length: visiblePips }, (_, index) => (
          <span
            key={index}
            className={index < actionPoints.current ? 'is-filled' : undefined}
            aria-hidden="true"
          />
        ))}
        {actionPoints.maximum > visiblePips ? (
          <small>另有 {actionPoints.maximum - visiblePips} 点</small>
        ) : null}
      </div>
      <p aria-label={reactionCharges.textZhCn}>
        反应次数：{reactionCharges.current}/{reactionCharges.maximum}
      </p>
    </section>
  );
}

function Meter({
  label,
  meter,
  tone,
}: {
  readonly label: string;
  readonly meter: CombatMeterViewModel;
  readonly tone: 'health' | 'shield';
}) {
  return (
    <div className={`character-hud__meter character-hud__meter--${tone}`}>
      <div>
        <strong>{label}</strong>
        <span>{meter.textZhCn}</span>
      </div>
      <MeterTrack
        current={meter.current}
        minimum={0}
        maximum={meter.maximum}
        label={meter.textZhCn}
      />
    </div>
  );
}

function MeterTrack({
  current,
  minimum,
  maximum,
  label,
}: {
  readonly current: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly label: string;
}) {
  const range = maximum - minimum;
  const percentage =
    range <= 0 ? 0 : Math.max(0, Math.min(100, ((current - minimum) / range) * 100));
  return (
    <div
      className="combat-meter-track"
      role="meter"
      aria-label={label}
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={current}
    >
      <span style={{ width: `${String(percentage)}%` }} />
    </div>
  );
}

function requiredCombatant(
  combatants: readonly CombatantStageViewModel[],
  combatantId: string | null,
): CombatantStageViewModel {
  const combatant = combatants.find((candidate) => candidate.combatantId === combatantId);
  if (combatant === undefined) throw new Error('ViewModel active combatant is missing');
  return combatant;
}

function firstVisibleCharacter(value: string): string {
  return Array.from(value.trim())[0] ?? '·';
}
