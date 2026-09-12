import { useEffect, useId, useState } from 'react';

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

export interface CombatValueTransitionViewModel {
  readonly before: number;
  readonly after: number;
  readonly textZhCn: string;
}

export interface CombatResourceTransitionViewModel extends CombatValueTransitionViewModel {
  readonly resourceId: string;
  readonly labelZhCn: string;
  readonly overheatThreshold: number | null;
  readonly isOverheatedBefore: boolean;
  readonly isOverheatedAfter: boolean;
}

export interface CombatCostPreviewViewModel {
  readonly actionPoints: CombatValueTransitionViewModel;
  readonly resources: readonly CombatResourceTransitionViewModel[];
}

export type TooltipLineKind =
  | 'ACTION_POINT'
  | 'RESOURCE'
  | 'RESOLUTION'
  | 'DAMAGE'
  | 'HEALING'
  | 'SHIELD'
  | 'CRITICAL'
  | 'SAVE'
  | 'STATUS'
  | 'COOLDOWN'
  | 'TARGET'
  | 'EFFECT'
  | 'TAG';

export interface CombatAbilityTooltipViewModel {
  readonly flavor: {
    readonly displayName: string;
    readonly flavorDescription: string;
    readonly lore: string;
  };
  readonly mechanics: {
    readonly abilityId: string;
    readonly lines: readonly {
      readonly kind: TooltipLineKind;
      readonly sourceIds: readonly string[];
      readonly text: string;
    }[];
  };
}

export interface CombatActionViewModel {
  readonly actionId: string;
  readonly displayNameZhCn: string;
  readonly kind: CombatActionViewKind;
  readonly requiresTarget: boolean;
  readonly enabled: boolean;
  readonly legalTargetIds: readonly string[];
  readonly disabledReasonsZhCn: readonly string[];
  readonly abilityUsage: CombatAbilityUsageViewModel | null;
  readonly costPreview: CombatCostPreviewViewModel | null;
  readonly tooltip: CombatAbilityTooltipViewModel | null;
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
  readonly reactionModes: readonly CombatReactionModeSettingViewModel[];
  readonly pendingReaction: CombatReactionPromptViewModel | null;
  readonly tacticalSettings: readonly CompanionTacticalViewModel[];
}

export type CombatReactionModeView = 'AUTO' | 'ASK' | 'DISABLED';

export interface CombatReactionModeSettingViewModel {
  readonly reactionId: string;
  readonly displayNameZhCn: string;
  readonly mode: CombatReactionModeView;
  readonly modeLabelZhCn: string;
}

export interface CombatReactionOptionViewModel extends CombatReactionModeSettingViewModel {
  readonly costSummaryZhCn: string;
  readonly effectSummaryZhCn: string;
}

export interface CombatReactionPromptViewModel {
  readonly reactionWindowId: string;
  readonly actorId: string;
  readonly actorNameZhCn: string;
  readonly options: readonly CombatReactionOptionViewModel[];
}

export type TacticalStrategyPreset =
  'BALANCED' | 'AGGRESSIVE' | 'DEFENSIVE' | 'SUPPORT' | 'CONSERVATIVE';
export type UltimatePolicy = 'FREE_USE' | 'ELITE_BOSS_PRIORITY' | 'HOLD';
export type ConsumablePolicy = 'ALLOW' | 'EMERGENCY_ONLY' | 'DISABLED';
export type ProtectMainCharacterPriority = 'LOW' | 'NORMAL' | 'HIGH';

export interface CompanionTacticalViewModel {
  readonly companionId: string;
  readonly displayNameZhCn: string;
  readonly strategy: TacticalStrategyPreset;
  readonly strategyLabelZhCn: string;
  readonly healingThresholdPercent: 30 | 50 | 70;
  readonly ultimatePolicy: UltimatePolicy;
  readonly ultimatePolicyLabelZhCn: string;
  readonly consumablePolicy: ConsumablePolicy;
  readonly consumablePolicyLabelZhCn: string;
  readonly protectMainCharacter: ProtectMainCharacterPriority;
  readonly protectMainCharacterLabelZhCn: string;
  readonly lastAppliedSequence: number;
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
  const [targetSelection, setTargetSelection] = useState<{
    readonly combatInstanceId: string;
    readonly stateRevision: number;
    readonly actionId: string;
  } | null>(null);
  const [submittedReaction, setSubmittedReaction] = useState<{
    readonly combatInstanceId: string;
    readonly stateRevision: number;
    readonly reactionWindowId: string;
  } | null>(null);
  const party = viewModel.combatants.filter(
    (combatant) => combatant.side === 'PLAYER' || combatant.side === 'COMPANION',
  );
  const hostiles = viewModel.combatants.filter((combatant) => combatant.side === 'HOSTILE');
  const neutral = viewModel.combatants.filter((combatant) => combatant.side === 'NEUTRAL');
  const activeName = viewModel.combatants.find(
    (combatant) => combatant.combatantId === viewModel.activeCombatantId,
  )?.displayNameZhCn;
  const selectedAction = viewModel.actions.find(
    (action) =>
      targetSelection?.combatInstanceId === viewModel.combatInstanceId &&
      targetSelection.stateRevision === viewModel.stateRevision &&
      action.actionId === targetSelection.actionId &&
      action.kind === 'ABILITY' &&
      action.enabled &&
      action.requiresTarget,
  );
  const reactionDecisionPending =
    submittedReaction?.combatInstanceId === viewModel.combatInstanceId &&
    submittedReaction.stateRevision === viewModel.stateRevision &&
    submittedReaction.reactionWindowId === viewModel.pendingReaction?.reactionWindowId;

  useEffect(() => {
    if (selectedAction === undefined) return undefined;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTargetSelection(null);
    };
    window.addEventListener('keydown', cancelOnEscape);
    return () => {
      window.removeEventListener('keydown', cancelOnEscape);
    };
  }, [selectedAction]);

  const submitAbility = (action: CombatActionViewModel, targetId: string | null) => {
    commandPort.submitCommand(
      commandPort.createCommand({
        kind: 'USE_ABILITY',
        abilityId: action.actionId,
        targetId,
      }),
    );
  };

  const selectAbility = (actionId: string) => {
    const action = viewModel.actions.find(
      (candidate) => candidate.actionId === actionId && candidate.kind === 'ABILITY',
    );
    if (action === undefined || !action.enabled) return;
    commandPort.onAbilitySelected(action.actionId);
    if (!action.requiresTarget) {
      setTargetSelection(null);
      submitAbility(action, null);
      return;
    }
    setTargetSelection({
      combatInstanceId: viewModel.combatInstanceId,
      stateRevision: viewModel.stateRevision,
      actionId: action.actionId,
    });
  };

  const selectTarget = (targetId: string) => {
    if (selectedAction === undefined || !selectedAction.legalTargetIds.includes(targetId)) return;
    submitAbility(selectedAction, targetId);
    setTargetSelection(null);
  };

  const submitPayload = (payload: CombatCommandPayload) => {
    commandPort.submitCommand(commandPort.createCommand(payload));
  };

  const submitReactionDecision = (
    prompt: CombatReactionPromptViewModel,
    choice: 'TRIGGER' | 'SKIP',
    selectedReactionId: string | null,
  ) => {
    if (reactionDecisionPending) return;
    setSubmittedReaction({
      combatInstanceId: viewModel.combatInstanceId,
      stateRevision: viewModel.stateRevision,
      reactionWindowId: prompt.reactionWindowId,
    });
    submitPayload({
      kind: 'RESOLVE_REACTION',
      reactionWindowId: prompt.reactionWindowId,
      choice,
      selectedReactionId,
    });
  };

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

      <BattleStage
        party={party}
        hostiles={hostiles}
        neutral={neutral}
        targetSelection={
          selectedAction === undefined
            ? null
            : {
                actionNameZhCn: selectedAction.displayNameZhCn,
                legalTargetIds: selectedAction.legalTargetIds,
                onTargetSelected: selectTarget,
                onCancelled: () => {
                  setTargetSelection(null);
                },
              }
        }
      />

      <ReactionModeStrip modes={viewModel.reactionModes} />

      <TacticalStrategyPanel settings={viewModel.tacticalSettings} onCommand={submitPayload} />

      {activeName === undefined ? null : (
        <CharacterHUD
          combatant={requiredCombatant(viewModel.combatants, viewModel.activeCombatantId)}
        />
      )}

      <ActionBar
        actions={viewModel.actions}
        commandPort={commandPort}
        selectedActionId={selectedAction?.actionId ?? null}
        onAbilitySelected={selectAbility}
        onTargetSelectionCancelled={() => {
          setTargetSelection(null);
        }}
      />

      {viewModel.pendingReaction === null ? null : (
        <ReactionPrompt
          prompt={viewModel.pendingReaction}
          decisionPending={reactionDecisionPending}
          onDecision={submitReactionDecision}
        />
      )}
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
  targetSelection = null,
}: {
  readonly party: readonly CombatantStageViewModel[];
  readonly hostiles: readonly CombatantStageViewModel[];
  readonly neutral: readonly CombatantStageViewModel[];
  readonly targetSelection?: TargetSelectionViewModel | null;
}) {
  const targeting =
    targetSelection === null
      ? undefined
      : {
          actionNameZhCn: targetSelection.actionNameZhCn,
          legalTargetIds: new Set(targetSelection.legalTargetIds),
          onTargetSelected: targetSelection.onTargetSelected,
        };
  return (
    <section
      className={targetSelection === null ? 'battle-stage' : 'battle-stage is-targeting'}
      aria-label="战斗场景"
      onClick={(event) => {
        if (event.target === event.currentTarget) targetSelection?.onCancelled();
      }}
    >
      <CombatantGroup
        className="battle-stage__party"
        label="我方队伍"
        combatants={party}
        targeting={targeting}
      />
      <div
        className="battle-stage__focus"
        aria-hidden="true"
        onClick={() => {
          targetSelection?.onCancelled();
        }}
      >
        <span />
        <strong>交战区域</strong>
        <span />
      </div>
      <CombatantGroup
        className="battle-stage__hostiles"
        label="敌方队伍"
        combatants={hostiles}
        targeting={targeting}
      />
      {neutral.length > 0 ? (
        <CombatantGroup
          className="battle-stage__neutral"
          label="中立单位"
          combatants={neutral}
          targeting={targeting}
        />
      ) : null}
    </section>
  );
}

export interface TargetSelectionViewModel {
  readonly actionNameZhCn: string;
  readonly legalTargetIds: readonly string[];
  readonly onTargetSelected: (targetId: string) => void;
  readonly onCancelled: () => void;
}

function CombatantGroup({
  className,
  label,
  combatants,
  targeting,
}: {
  readonly className: string;
  readonly label: string;
  readonly combatants: readonly CombatantStageViewModel[];
  readonly targeting?:
    | {
        readonly actionNameZhCn: string;
        readonly legalTargetIds: ReadonlySet<string>;
        readonly onTargetSelected: (targetId: string) => void;
      }
    | undefined;
}) {
  return (
    <section className={`combatant-group ${className}`} aria-label={label}>
      <h2>{label}</h2>
      <div className="combatant-group__roster">
        {combatants.map((combatant) => (
          <CombatantView
            key={combatant.combatantId}
            combatant={combatant}
            targetActionNameZhCn={targeting?.actionNameZhCn}
            isLegalTarget={targeting?.legalTargetIds.has(combatant.combatantId) ?? false}
            onTargetSelected={targeting?.onTargetSelected}
          />
        ))}
      </div>
    </section>
  );
}

export function CombatantView({
  combatant,
  targetActionNameZhCn,
  isLegalTarget = false,
  onTargetSelected,
}: {
  readonly combatant: CombatantStageViewModel;
  readonly targetActionNameZhCn?: string | undefined;
  readonly isLegalTarget?: boolean;
  readonly onTargetSelected?: ((targetId: string) => void) | undefined;
}) {
  const content = (
    <>
      <div className="combatant-view__portrait" aria-hidden="true">
        {firstVisibleCharacter(combatant.displayNameZhCn)}
      </div>
      <div className="combatant-view__identity">
        <strong>{combatant.displayNameZhCn}</strong>
        <span>{combatant.sideLabelZhCn}</span>
      </div>
      <span className="combatant-view__state">{combatant.stateLabelZhCn}</span>
    </>
  );
  return (
    <article
      className={`combatant-view combatant-view--${combatant.side.toLowerCase()}${combatant.isActiveTurn ? ' is-active' : ''}${isLegalTarget ? ' is-legal-target' : ''}`}
      aria-label={`${combatant.displayNameZhCn}，${combatant.sideLabelZhCn}，${combatant.stateLabelZhCn}`}
      aria-current={combatant.isActiveTurn ? 'true' : undefined}
      data-combatant-id={combatant.combatantId}
      data-target-state={
        targetActionNameZhCn === undefined ? undefined : isLegalTarget ? 'legal' : 'unavailable'
      }
    >
      {isLegalTarget && targetActionNameZhCn !== undefined && onTargetSelected !== undefined ? (
        <button
          type="button"
          className="combatant-view__target"
          aria-label={`选择${combatant.displayNameZhCn}作为${targetActionNameZhCn}的目标`}
          onClick={() => {
            onTargetSelected(combatant.combatantId);
          }}
        >
          {content}
        </button>
      ) : (
        content
      )}
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

export function ReactionModeStrip({
  modes,
}: {
  readonly modes: readonly CombatReactionModeSettingViewModel[];
}) {
  if (modes.length === 0) return null;
  return (
    <section className="reaction-mode-strip" aria-label="反应模式">
      <h2>反应模式</h2>
      <ul>
        {modes.map((reaction) => (
          <li key={reaction.reactionId} data-reaction-mode={reaction.mode}>
            <span>{reaction.displayNameZhCn}</span>
            <strong>{reaction.modeLabelZhCn}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TacticalStrategyPanel({
  settings,
  onCommand,
}: {
  readonly settings: readonly CompanionTacticalViewModel[];
  readonly onCommand: (payload: CombatCommandPayload) => void;
}) {
  if (settings.length === 0) return null;
  return (
    <section className="tactical-strategy-panel" aria-label="队友战术策略">
      <h2>队友战术</h2>
      <div className="tactical-strategy-panel__companions">
        {settings.map((companion) => (
          <fieldset key={companion.companionId} data-companion-id={companion.companionId}>
            <legend>{companion.displayNameZhCn}</legend>
            <label>
              基础策略
              <select
                aria-label={`${companion.displayNameZhCn}的基础策略`}
                value={companion.strategy}
                onChange={(event) => {
                  onCommand({
                    kind: 'SET_TACTICAL_STRATEGY',
                    companionId: companion.companionId,
                    strategyId: event.currentTarget.value,
                  });
                }}
              >
                {TACTICAL_STRATEGIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              治疗阈值
              <select
                aria-label={`${companion.displayNameZhCn}的治疗阈值`}
                value={companion.healingThresholdPercent}
                onChange={(event) => {
                  onCommand({
                    kind: 'SET_TACTICAL_PREFERENCE',
                    companionId: companion.companionId,
                    preferenceKey: 'healingThreshold',
                    structuredValue: {
                      valueType: 'INTEGER',
                      value: Number(event.currentTarget.value),
                    },
                  });
                }}
              >
                {[30, 50, 70].map((value) => (
                  <option key={value} value={value}>
                    {value}%
                  </option>
                ))}
              </select>
            </label>
            <TacticalStableIdPreference
              companion={companion}
              label="终极技能"
              preferenceKey="ultimatePolicy"
              value={companion.ultimatePolicy}
              options={ULTIMATE_POLICIES}
              onCommand={onCommand}
            />
            <TacticalStableIdPreference
              companion={companion}
              label="消耗品"
              preferenceKey="consumablePolicy"
              value={companion.consumablePolicy}
              options={CONSUMABLE_POLICIES}
              onCommand={onCommand}
            />
            <TacticalStableIdPreference
              companion={companion}
              label="保护主角"
              preferenceKey="protectMainCharacter"
              value={companion.protectMainCharacter}
              options={PROTECT_PRIORITIES}
              onCommand={onCommand}
            />
            <small>
              {companion.lastAppliedSequence === 0
                ? '使用默认设置'
                : `已应用至命令序列 ${String(companion.lastAppliedSequence)}`}
            </small>
          </fieldset>
        ))}
      </div>
    </section>
  );
}

function TacticalStableIdPreference({
  companion,
  label,
  preferenceKey,
  value,
  options,
  onCommand,
}: {
  readonly companion: CompanionTacticalViewModel;
  readonly label: string;
  readonly preferenceKey: 'ultimatePolicy' | 'consumablePolicy' | 'protectMainCharacter';
  readonly value: string;
  readonly options: readonly (readonly [string, string])[];
  readonly onCommand: (payload: CombatCommandPayload) => void;
}) {
  return (
    <label>
      {label}
      <select
        aria-label={`${companion.displayNameZhCn}的${label}`}
        value={value}
        onChange={(event) => {
          onCommand({
            kind: 'SET_TACTICAL_PREFERENCE',
            companionId: companion.companionId,
            preferenceKey,
            structuredValue: { valueType: 'STABLE_ID', value: event.currentTarget.value },
          });
        }}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ReactionPrompt({
  prompt,
  decisionPending,
  onDecision,
}: {
  readonly prompt: CombatReactionPromptViewModel;
  readonly decisionPending: boolean;
  readonly onDecision: (
    prompt: CombatReactionPromptViewModel,
    choice: 'TRIGGER' | 'SKIP',
    selectedReactionId: string | null,
  ) => void;
}) {
  return (
    <aside
      className="reaction-prompt"
      aria-label={`${prompt.actorNameZhCn}的反应选择`}
      aria-live="assertive"
      aria-busy={decisionPending}
      data-reaction-window-id={prompt.reactionWindowId}
    >
      <header>
        <span>可触发反应</span>
        <strong>{prompt.actorNameZhCn}</strong>
      </header>
      <ul>
        {prompt.options.map((option) => (
          <li key={option.reactionId} data-reaction-id={option.reactionId}>
            <div>
              <strong>{option.displayNameZhCn}</strong>
              <span>模式：{option.modeLabelZhCn}</span>
            </div>
            <p>{option.costSummaryZhCn}</p>
            <p>{option.effectSummaryZhCn}</p>
            <button
              type="button"
              disabled={decisionPending}
              onClick={() => {
                onDecision(prompt, 'TRIGGER', option.reactionId);
              }}
            >
              发动
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="reaction-prompt__skip"
        disabled={decisionPending}
        onClick={() => {
          onDecision(prompt, 'SKIP', null);
        }}
      >
        跳过
      </button>
      {decisionPending ? <p role="status">正在处理反应决定</p> : null}
    </aside>
  );
}

const TACTICAL_STRATEGIES = [
  ['BALANCED', '均衡'],
  ['AGGRESSIVE', '进攻'],
  ['DEFENSIVE', '防守'],
  ['SUPPORT', '支援'],
  ['CONSERVATIVE', '保守'],
] as const;
const ULTIMATE_POLICIES = [
  ['FREE_USE', '自由使用'],
  ['ELITE_BOSS_PRIORITY', '精英与首领优先'],
  ['HOLD', '保留'],
] as const;
const CONSUMABLE_POLICIES = [
  ['ALLOW', '允许'],
  ['EMERGENCY_ONLY', '仅紧急时'],
  ['DISABLED', '禁用'],
] as const;
const PROTECT_PRIORITIES = [
  ['LOW', '低'],
  ['NORMAL', '普通'],
  ['HIGH', '高'],
] as const;

export function ActionBar({
  actions,
  commandPort,
  selectedActionId = null,
  onAbilitySelected = commandPort.onAbilitySelected,
  onTargetSelectionCancelled,
}: {
  readonly actions: readonly CombatActionViewModel[];
  readonly commandPort: CombatCommandPort;
  readonly selectedActionId?: string | null;
  readonly onAbilitySelected?: (actionId: string) => void;
  readonly onTargetSelectionCancelled?: () => void;
}) {
  const abilities = actions.filter((action) => action.kind === 'ABILITY');
  const endTurn = actions.find((action) => action.kind === 'END_TURN');
  const selectedAction = abilities.find((action) => action.actionId === selectedActionId);
  return (
    <section className="action-bar" aria-label="战斗行动">
      {selectedAction === undefined ? null : (
        <div className="target-selection-prompt" role="status" aria-live="polite">
          <span>正在为“{selectedAction.displayNameZhCn}”选择目标</span>
          <button
            type="button"
            onClick={() => {
              onTargetSelectionCancelled?.();
            }}
          >
            取消选取
          </button>
        </div>
      )}
      <div className="action-bar__abilities" role="group" aria-label="技能">
        {abilities.map((action) => (
          <AbilitySlot
            key={action.actionId}
            action={action}
            selected={action.actionId === selectedActionId}
            onSelected={onAbilitySelected}
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
  selected = false,
  onSelected,
}: {
  readonly action: CombatActionViewModel;
  readonly selected?: boolean;
  readonly onSelected: (actionId: string) => void;
}) {
  const reasonId = useId();
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  if (
    action.kind !== 'ABILITY' ||
    action.abilityUsage === null ||
    action.costPreview === null ||
    action.tooltip === null ||
    action.tooltip.mechanics.abilityId !== action.actionId
  ) {
    throw new Error('AbilitySlot requires an ability action');
  }
  const usage = action.abilityUsage;
  const usageLines = abilityUsageLines(usage);
  const tooltipOpen = selected || hovered || focused;
  return (
    <div
      className={selected ? 'ability-slot is-selected' : 'ability-slot'}
      data-action-id={action.actionId}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <button
        type="button"
        disabled={!action.enabled}
        aria-label={action.displayNameZhCn}
        aria-pressed={selected}
        aria-describedby={action.enabled ? tooltipId : `${tooltipId} ${reasonId}`}
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
      <AbilityTooltipPanel id={tooltipId} action={action} hidden={!tooltipOpen} />
    </div>
  );
}

export function AbilityTooltipPanel({
  id,
  action,
  hidden,
}: {
  readonly id: string;
  readonly action: CombatActionViewModel;
  readonly hidden: boolean;
}) {
  if (action.costPreview === null || action.tooltip === null) {
    throw new Error('AbilityTooltipPanel requires projected tooltip data');
  }
  return (
    <aside id={id} className="ability-tooltip" role="tooltip" hidden={hidden}>
      <header>
        <strong>{action.tooltip.flavor.displayName}</strong>
        <p>{action.tooltip.flavor.flavorDescription}</p>
        <small>{action.tooltip.flavor.lore}</small>
      </header>
      <section aria-label="消耗预览">
        <h3>使用后预览</h3>
        <ul className="ability-tooltip__costs">
          <li>{action.costPreview.actionPoints.textZhCn}</li>
          {action.costPreview.resources.map((resource) => (
            <li
              key={resource.resourceId}
              data-resource-id={resource.resourceId}
              data-overheated-after={resource.isOverheatedAfter ? 'true' : 'false'}
            >
              {resource.textZhCn}
              {resource.overheatThreshold === null
                ? null
                : `（过热阈值 ${String(resource.overheatThreshold)}${resource.isOverheatedAfter ? '，使用后过热' : ''}）`}
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="技能规则">
        <h3>规则数据</h3>
        <ul className="ability-tooltip__mechanics">
          {action.tooltip.mechanics.lines.map((line, index) => (
            <li
              key={`${line.kind}:${line.sourceIds.join(',')}:${String(index)}`}
              data-tooltip-kind={line.kind}
              data-source-ids={line.sourceIds.join(',')}
            >
              {line.text}
            </li>
          ))}
        </ul>
      </section>
    </aside>
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
