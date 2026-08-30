import type { PlaytestWorldKey } from './playability-worlds.js';

export const FREE_INPUT_STRESS_CATEGORIES = [
  'REFUSE_QUEST',
  'DECEIVE_PUBLISHER',
  'BUY_TAVERN',
  'STEAL',
  'LEAVE_TOWN',
  'LONG_TERM_PASSERBY',
  'SELL_QUEST_ITEM',
  'DEFECT_TO_ENEMY',
] as const;

export type FreeInputStressCategory = (typeof FREE_INPUT_STRESS_CATEGORIES)[number];
export type FreeInputStressOutcome = 'SUCCEEDED' | 'FAILED' | 'REJECTED';

export interface FreeInputStressAction {
  readonly sequence: number;
  readonly id: string;
  readonly world: PlaytestWorldKey;
  readonly category: FreeInputStressCategory;
  readonly input: string;
  readonly expectedOutcome: FreeInputStressOutcome;
}

export const FREE_INPUT_STRESS_ACTIONS: readonly FreeInputStressAction[] = Object.freeze([
  action(
    1,
    'fantasy-refuse-quest',
    'fantasy',
    'REFUSE_QUEST',
    '我拒绝继续钟塔誓约，请把这项委托从我的承诺中撤下。',
    'SUCCEEDED',
  ),
  action(
    2,
    'investigation-deceive-publisher',
    'investigation',
    'DECEIVE_PUBLISHER',
    '我谎称亲眼看见罗兹在凌晨两点搬走发报机，要求你立即公开指控。',
    'FAILED',
  ),
  action(
    3,
    'fantasy-buy-tavern',
    'fantasy',
    'BUY_TAVERN',
    '我出十二枚银币买下断梁酒馆，现在就把产权交给我。',
    'REJECTED',
  ),
  action(
    4,
    'fantasy-steal',
    'fantasy',
    'STEAL',
    '趁玛菈转身时，我伸手偷走柜台下的钱匣。',
    'FAILED',
  ),
  action(
    5,
    'investigation-leave-town',
    'investigation',
    'LEAVE_TOWN',
    '我暂时离开雾港，沿公路前往海雾观测站，不等待推荐路线。',
    'SUCCEEDED',
  ),
  action(
    6,
    'investigation-long-talk',
    'investigation',
    'LONG_TERM_PASSERBY',
    '我连续三天与早班邮差交谈，只核对他亲历的邮路与目击顺序。',
    'SUCCEEDED',
  ),
  action(
    7,
    'cyberpunk-sell-quest-item',
    'cyberpunk',
    'SELL_QUEST_ITEM',
    '我要把仍绑定失联节点支线的净化访问片卖掉，立即换取信用点。',
    'REJECTED',
  ),
  action(
    8,
    'cyberpunk-defect',
    'cyberpunk',
    'DEFECT_TO_ENEMY',
    '我公开投靠栖桥公司，接受七码头互助网因此改变对我的关系。',
    'SUCCEEDED',
  ),
]);

validateFreeInputStressActions(FREE_INPUT_STRESS_ACTIONS);

export function validateFreeInputStressActions(actions: readonly FreeInputStressAction[]): void {
  if (actions.length !== FREE_INPUT_STRESS_CATEGORIES.length) {
    throw new Error('Free-input stress must contain exactly the eight required categories');
  }
  const ids = new Set<string>();
  const categories = new Set<FreeInputStressCategory>();
  const worlds = new Set<PlaytestWorldKey>();
  const outcomes = new Set<FreeInputStressOutcome>();
  actions.forEach((candidate, index) => {
    if (
      candidate.sequence !== index + 1 ||
      candidate.id.trim() !== candidate.id ||
      candidate.id.length < 3 ||
      candidate.input.trim() !== candidate.input ||
      candidate.input.length < 2 ||
      candidate.input.length > 4_000 ||
      ids.has(candidate.id) ||
      categories.has(candidate.category)
    ) {
      throw new Error(`Invalid free-input stress action at sequence ${index + 1}`);
    }
    ids.add(candidate.id);
    categories.add(candidate.category);
    worlds.add(candidate.world);
    outcomes.add(candidate.expectedOutcome);
  });
  if (
    FREE_INPUT_STRESS_CATEGORIES.some((category) => !categories.has(category)) ||
    !(['fantasy', 'investigation', 'cyberpunk'] as const).every((world) => worlds.has(world)) ||
    !(['SUCCEEDED', 'FAILED', 'REJECTED'] as const).every((outcome) => outcomes.has(outcome))
  ) {
    throw new Error('Free-input stress coverage is incomplete');
  }
}

function action(
  sequence: number,
  id: string,
  world: PlaytestWorldKey,
  category: FreeInputStressCategory,
  input: string,
  expectedOutcome: FreeInputStressOutcome,
): FreeInputStressAction {
  return Object.freeze({ sequence, id, world, category, input, expectedOutcome });
}
