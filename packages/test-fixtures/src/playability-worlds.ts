import type {
  CharacterExtensionFieldDefinition,
  CharacterTrait,
  QuestRisk,
  WorldConstitutionContent,
} from '@ember-tavern/contracts';

export const PLAYTEST_WORLD_KEYS = ['fantasy', 'investigation', 'cyberpunk'] as const;
export type PlaytestWorldKey = (typeof PLAYTEST_WORLD_KEYS)[number];

export const PLAYTEST_ACTION_KINDS = [
  'START_CAMPAIGN',
  'CREATE_CHARACTER',
  'ENTER_TAVERN',
  'TALK_NPC',
  'INSPECT_RUMOR',
  'ACCEPT_QUEST',
  'FREE_INPUT',
  'TRAVEL',
  'D20_ACTION',
  'EQUIP_ITEM',
  'TRADE',
  'SAVE_REOPEN',
  'ADVANCE_TIME',
  'REVIEW_STATE',
] as const;
export type PlaytestActionKind = (typeof PLAYTEST_ACTION_KINDS)[number];

export const PLAYTEST_EVIDENCE_KINDS = [
  'OUTPUT',
  'LATENCY',
  'STATE_DIGEST',
  'KNOWLEDGE_BOUNDARY',
  'QUEST_STATE',
  'D20_HARD_RESULT',
  'ECONOMY_EQUIPMENT',
  'WORLD_STATE',
  'REOPEN_STATE',
  'CONSEQUENCE',
] as const;
export type PlaytestEvidenceKind = (typeof PLAYTEST_EVIDENCE_KINDS)[number];

export interface PlaytestCareerSeed {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly skills: readonly string[];
  readonly equipmentTags: readonly string[];
  readonly socialPosition: string;
}

export interface PlaytestEquipmentSeed {
  readonly id: string;
  readonly name: string;
  readonly category: 'WEAPON' | 'ARMOR' | 'TOOL' | 'CONSUMABLE' | 'CLUE' | 'OTHER';
  readonly description: string;
  readonly ruleHook: string;
}

export interface PlaytestNpcSeed {
  readonly id: string;
  readonly name: string;
  readonly identity: string;
  readonly personality: string;
  readonly goal: string;
  readonly hiddenMotive: string;
  readonly knowledgeBoundary: string;
}

export interface PlaytestQuestSeed {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly failureCost: string;
  readonly risk: QuestRisk;
  readonly publisherNpcId: string;
}

export interface PlaytestExtensionSeed {
  readonly namespace: string;
  readonly displayName: string;
  readonly fields: readonly CharacterExtensionFieldDefinition[];
  readonly initialValues: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}

export interface PlaytestAction {
  readonly sequence: number;
  readonly id: string;
  readonly kind: PlaytestActionKind;
  readonly input: string;
  readonly requiredEvidence: readonly PlaytestEvidenceKind[];
}

export interface PlaytestWorldFixture {
  readonly schemaVersion: 1;
  readonly dataOrigin: 'SYNTHETIC_M11';
  readonly key: PlaytestWorldKey;
  readonly campaignId: string;
  readonly displayName: string;
  readonly constitution: WorldConstitutionContent;
  readonly careers: readonly PlaytestCareerSeed[];
  readonly equipment: readonly PlaytestEquipmentSeed[];
  readonly traits: readonly CharacterTrait[];
  readonly npcs: readonly PlaytestNpcSeed[];
  readonly quests: readonly PlaytestQuestSeed[];
  readonly extension: PlaytestExtensionSeed;
  readonly behaviorScript: readonly PlaytestAction[];
}

type ActionSeed = readonly [kind: PlaytestActionKind, input: string];

const fantasyActions: readonly ActionSeed[] = [
  ['START_CAMPAIGN', '以“灰烬潮下的烛湾”为世界种子创建新战役并确认世界宪章。'],
  ['CREATE_CHARACTER', '创建一名雾钟抄契人，保留契约职业、余烬听觉与誓债特质。'],
  ['ENTER_TAVERN', '进入断梁酒馆，观察当前住客、传闻与酒馆时钟。'],
  ['TALK_NPC', '询问玛菈为何把东门巡夜表藏在酒桶夹层。'],
  ['INSPECT_RUMOR', '核对“灰潮会在第三声钟响后倒流”的来源与可信度。'],
  ['ACCEPT_QUEST', '接受《找回失火的潮汐账册》，但先不离开酒馆。'],
  ['FREE_INPUT', '公开质疑巡钟人奥尔德伪造了昨夜的点灯记录。'],
  ['D20_ACTION', '用知识检定辨认账册封蜡是否来自河港行会。'],
  ['EQUIP_ITEM', '装备缺口银灯，并检查它只影响既定可见规则。'],
  ['TRAVEL', '前往被潮水淹没的旧盐门，记录地点连接和耗时。'],
  ['TALK_NPC', '向守门人索要昨夜放行名单，不透露玛菈的怀疑。'],
  ['FREE_INPUT', '尝试用一份未来收益承诺换取盐门钥匙。'],
  ['D20_ACTION', '在涨潮前攀上断裂钟塔，接受失败造成的时间后果。'],
  ['INSPECT_RUMOR', '比较奥尔德、玛菈和守门人对第三声钟的不同认知。'],
  ['ADVANCE_TIME', '在旧盐门等待一刻钟，观察酒馆与任务是否同步推进。'],
  ['ACCEPT_QUEST', '发现并激活《钟塔下的无名誓约》支线。'],
  ['TRADE', '向旧物商出售一枚普通铜扣，确认价格不受传说文案膨胀。'],
  ['EQUIP_ITEM', '改穿荆纹短披风，确认同槽位装备替换而非叠加。'],
  ['FREE_INPUT', '把找到账册的消息只告诉玛菈，不通知巡钟人。'],
  ['TALK_NPC', '追问奥尔德对旧盐门火灾的个人记忆与未知部分。'],
  ['D20_ACTION', '用魅力检定说服奥尔德交出半张烧焦的巡夜图。'],
  ['TRAVEL', '返回断梁酒馆，验证路程时间与 NPC 当前状态。'],
  ['SAVE_REOPEN', '保存并重启，复核任务、装备、金钱、时钟和 NPC 认知。'],
  ['REVIEW_STATE', '审阅角色、Trait、D20 历史与两条任务的当前状态。'],
  ['FREE_INPUT', '拒绝把账册交给任一行会，提出在酒馆当众宣读。'],
  ['D20_ACTION', '用体魄检定保护账册免受抢夺，保留同一次硬结果。'],
  ['ADVANCE_TIME', '让酒馆时钟跨过午夜，观察每日预算与传闻变化。'],
  ['TALK_NPC', '询问新到访旅人是否亲眼见过灰潮倒流。'],
  ['TRADE', '购买一份普通灯油，核对库存、金钱与消耗品用途。'],
  ['FREE_INPUT', '把缺口银灯借给玛菈并要求她独自验证封蜡。'],
  ['SAVE_REOPEN', '再次保存重启，检查借出物品和隐秘信息没有回滚。'],
  ['REVIEW_STATE', '记录世界、人格、知识、Quest、装备、Director 与 Context 观察。'],
];

const investigationActions: readonly ActionSeed[] = [
  ['START_CAMPAIGN', '以“雾港失踪电台”为世界种子创建调查战役并锁定宪章。'],
  ['CREATE_CHARACTER', '创建一名夜渡档案员，填写镇定、机运、信用与线索负荷。'],
  ['ENTER_TAVERN', '进入潮痕咖啡馆，记录雨夜来客、公告和闭店时间。'],
  ['TALK_NPC', '询问伊芙琳最后一次听见失踪电台呼号的时间。'],
  ['INSPECT_RUMOR', '区分“地下室有第二台发报机”是目击、推测还是误导。'],
  ['ACCEPT_QUEST', '接受《凌晨两点的空白频段》，保留其他调查线索。'],
  ['FREE_INPUT', '要求查看咖啡馆电话账单，而不是立刻前往电台。'],
  ['D20_ACTION', '用知识检定比对账单号码与旧港务名录。'],
  ['EQUIP_ITEM', '携带折叠式板盒相机，确认它是证据工具而非武器加成。'],
  ['TRAVEL', '前往停用的海雾观测站，记录交通时间和天气变化。'],
  ['TALK_NPC', '向值夜员询问噪声记录，但不透露伊芙琳的姓名。'],
  ['FREE_INPUT', '故意给值夜员一个错误日期，观察其是否纠正或附和。'],
  ['D20_ACTION', '用敏捷检定在不破坏封条的情况下进入记录室。'],
  ['INSPECT_RUMOR', '交叉检查电话账单、噪声日志与值夜员陈述的矛盾。'],
  ['ADVANCE_TIME', '等待下一次整点广播，允许失败继续产生新线索。'],
  ['ACCEPT_QUEST', '发现并激活《被涂黑的潮位表》关联调查。'],
  ['TRADE', '支付合理费用复制档案，确认信用与现金记录分离。'],
  ['EQUIP_ITEM', '使用封口证物袋保存磁带碎片，记录证据链。'],
  ['FREE_INPUT', '把一条未经证实的推论告诉报社，观察社会后果。'],
  ['TALK_NPC', '再次询问伊芙琳，检查她只回应已知或相信的内容。'],
  ['D20_ACTION', '用魅力检定让报社暂缓刊登，失败也不锁死调查。'],
  ['TRAVEL', '返回潮痕咖啡馆，验证 NPC 时序和地点记忆。'],
  ['SAVE_REOPEN', '保存并重启，复核线索、误导信息、Quest 与扩展数值。'],
  ['REVIEW_STATE', '审阅镇定、机运、信用、知识边界和调查图谱。'],
  ['FREE_INPUT', '拒绝把磁带交给警署，提议由三方共同封存。'],
  ['D20_ACTION', '用体魄检定搬开记录室倒柜，记录压力与失败代价。'],
  ['ADVANCE_TIME', '让调查跨过清晨，观察有限认知与任务时效变化。'],
  ['TALK_NPC', '询问早班邮差是否见过携带发报箱的陌生人。'],
  ['TRADE', '购买普通显影药剂，核对价格、用途和库存。'],
  ['FREE_INPUT', '尝试把无关旧照片当作筹码交换观测站钥匙。'],
  ['SAVE_REOPEN', '再次保存重启，确认失败线索和已公开误导仍可追溯。'],
  ['REVIEW_STATE', '记录人格、线索、Quest、World、Trait、Equipment 与 Context 观察。'],
];

const cyberpunkActions: readonly ActionSeed[] = [
  ['START_CAMPAIGN', '以“霓虹堤岸的断网夜”为世界种子创建赛博都市战役。'],
  ['CREATE_CHARACTER', '创建一名网格快递员，填写神经负荷、街区声望和追踪热度。'],
  ['ENTER_TAVERN', '进入余温中继站，记录在线住客、委托墙和区域断电倒计时。'],
  ['TALK_NPC', '询问修补师岚为什么拒绝接入市政备用网。'],
  ['INSPECT_RUMOR', '核对“栖桥公司正在回收免费义体”背后的传播链。'],
  ['ACCEPT_QUEST', '接受《送达离线密钥》，但不立即选择公司路线。'],
  ['FREE_INPUT', '提议把密钥拆分给三个街区节点共同保管。'],
  ['D20_ACTION', '用知识检定识别密钥壳体上的追踪固件。'],
  ['EQUIP_ITEM', '装备低温信号隔离套，确认负荷和插槽限制。'],
  ['TRAVEL', '穿过断电磁轨前往七码头，记录区域连接与时间。'],
  ['TALK_NPC', '向街医询问密钥原主人，但不暴露当前携带者。'],
  ['FREE_INPUT', '尝试用未来街区声望换取一次匿名义体扫描。'],
  ['D20_ACTION', '用敏捷检定避开巡检无人机，接受失败带来的热度。'],
  ['INSPECT_RUMOR', '比较公司公告、街医记录与修补师说法的权限差异。'],
  ['ADVANCE_TIME', '等待备用电网切换，观察派系和委托状态推进。'],
  ['ACCEPT_QUEST', '发现并激活《失联节点的最后心跳》支线。'],
  ['TRADE', '出售一块普通废旧电池，确认价格不受高科技描述膨胀。'],
  ['EQUIP_ITEM', '切换到折叠电弧扳手，检查同插槽工具不会叠加。'],
  ['FREE_INPUT', '把公司追踪证据公开给街区频道，但隐去街医身份。'],
  ['TALK_NPC', '追问岚对备用网后门的已知事实与个人猜测。'],
  ['D20_ACTION', '用魅力检定争取中继站管理员延迟日志上传。'],
  ['TRAVEL', '返回余温中继站，验证路线耗时和动态派系变化。'],
  ['SAVE_REOPEN', '保存并重启，复核义体负荷、声望、热度、装备和任务。'],
  ['REVIEW_STATE', '审阅角色扩展、NPC 认知、派系、经济与 D20 历史。'],
  ['FREE_INPUT', '拒绝把密钥卖给最高出价者，提出开源审计后再决定。'],
  ['D20_ACTION', '用体魄检定拖开断电闸门，保留失败造成的资源消耗。'],
  ['ADVANCE_TIME', '让城市时钟跨过公司换班点，观察预算和冷却。'],
  ['TALK_NPC', '询问新上线的外卖骑手是否见过公司回收队。'],
  ['TRADE', '购买标准散热凝胶，核对库存、信用点与消耗用途。'],
  ['FREE_INPUT', '把隔离套借给街医进行离线拆检并约定归还条件。'],
  ['SAVE_REOPEN', '再次保存重启，确认借出装备、声望和派系后果未回滚。'],
  ['REVIEW_STATE', '记录世界、Quest、Trait、Equipment、Director、Context 与缓存观察。'],
];

export const PLAYTEST_WORLD_FIXTURES: Readonly<Record<PlaytestWorldKey, PlaytestWorldFixture>> =
  Object.freeze({
    fantasy: worldFixture({
      key: 'fantasy',
      displayName: '灰烬潮下的烛湾',
      constitution: {
        worldType: '低魔黑暗奇幻港邦',
        era: '行会与封建领主并存的晚期中世纪',
        technology: '水车、帆船、锻钢与稀有炼金术',
        magic: '魔法依赖契约、材料与代价，不能凭空改写既成事实',
        peoples: ['沿岸人类', '盐沼矮裔', '迁徙林民'],
        society: '行会、领主与神殿共享脆弱秩序',
        politics: '港务议会与巡钟团争夺潮汐税和夜间通行权',
        economy: '银币、货契和实物债务并行，普通物资价格稳定',
        combatScale: '个人与小队冲突，伤势和补给持续生效',
        deathRules: '死亡永久；濒死必须由明确规则和资源处理',
        careerRules: '职业来自行会、神殿、领主或边地生计，并带社会义务',
        equipmentRules: '钢铁、皮革、炼金消耗品和有代价的符文器具',
        npcRules: 'NPC 只知道亲历、被告知或合理推断的事实，并保有私人目标',
        traitRules: '超常优势必须绑定可触发的代价或限制',
        taboos: ['无代价复活', '无限资源', '现代火器'],
      },
      careers: [
        career(
          'ash-watch',
          '灰烬守夜人',
          '巡守潮门与夜钟',
          ['警戒', '长柄武器'],
          ['守夜', '重甲'],
          '受巡钟团约束',
        ),
        career(
          'mist-scrivener',
          '雾钟抄契人',
          '抄录并仲裁港邦契约',
          ['古文书', '谈判'],
          ['文书', '灯具'],
          '行会认可的自由人',
        ),
        career(
          'marsh-guide',
          '盐沼引路者',
          '带队穿越潮沼与旧堤',
          ['追踪', '野外生存'],
          ['绳索', '轻装'],
          '边地居民与港商之间的中介',
        ),
      ],
      equipment: [
        equipment(
          'chipped-silver-lantern',
          '缺口银灯',
          'TOOL',
          '能显出特定封蜡纹路的旧灯。',
          '知识检定涉及封蜡时提供有界修正',
        ),
        equipment(
          'thorn-weave-cloak',
          '荆纹短披风',
          'ARMOR',
          '行会猎手使用的轻便披风。',
          '只在已装备时影响一次物理防护',
        ),
        equipment(
          'tide-ledger-fragment',
          '潮汐账册残页',
          'CLUE',
          '记载旧盐门夜间货运的烧焦残页。',
          '作为任务证据，不提供伤害数值',
        ),
      ],
      traits: [
        trait(
          'ember-hearing',
          '余烬听觉',
          '能从火焰细响中察觉异常，但持续噪声会使判断迟疑。',
          'MIXED',
          -1,
          1,
        ),
        trait(
          'oath-debt',
          '誓债在身',
          '面对公开承诺时更坚定，也更难撤回已经说出口的选择。',
          'NARRATIVE',
          0,
          0,
        ),
      ],
      npcs: [
        npc(
          'mara',
          '玛菈',
          '断梁酒馆掌柜',
          '克制、观察细致',
          '保住酒馆和住客',
          '她保存着失火前的半本账册',
          '不知道巡钟团内部命令',
        ),
        npc(
          'alder',
          '奥尔德',
          '疲惫的巡钟人',
          '守规矩但容易自责',
          '证明自己没有漏报潮钟',
          '他替同伴改过一次点灯时间',
          '不知道玛菈藏匿账册',
        ),
        npc(
          'vesh',
          '维什',
          '往返盐沼的旧物商',
          '热情、精于估价',
          '取得旧盐门的独家通行权',
          '他散布过一条夸大的灰潮传闻',
          '不知道账册封蜡来源',
        ),
      ],
      quests: [
        quest(
          'burned-tide-ledger',
          '找回失火的潮汐账册',
          '取得账册并确认封蜡来源',
          '港务议会将关闭旧盐门',
          'MODERATE',
          'mara',
        ),
        quest(
          'nameless-bell-oath',
          '钟塔下的无名誓约',
          '查明谁在无名钟上刻下新誓文',
          '巡钟团内部关系恶化',
          'HIGH',
          'alder',
        ),
        quest(
          'marsh-lanterns',
          '盐沼里熄灭的三盏灯',
          '恢复三处安全引路灯',
          '商路延误并抬高补给价格',
          'LOW',
          'vesh',
        ),
      ],
      extension: extension(
        'fantasy-oathcraft',
        '誓约与潮汐',
        [
          integerField('oathDebt', '誓债', 0, 10),
          enumField('guildStanding', '行会立场', ['疏远', '中立', '认可', '信赖']),
          textListField('knownRunes', '已识符文', 8, 40),
        ],
        { oathDebt: 1, guildStanding: '中立', knownRunes: ['潮门印'] },
      ),
      actions: fantasyActions,
    }),
    investigation: worldFixture({
      key: 'investigation',
      displayName: '雾港失踪电台',
      constitution: {
        worldType: '近代都市调查与心理悬疑',
        era: '架空的一九二〇年代海港工业城',
        technology: '有线电话、真空管电台、胶片摄影与燃油交通',
        magic: '异常现象稀少、暧昧且不能替代证据链',
        peoples: ['港城居民', '外来船员', '山地移民'],
        society: '警署、报社、工会和私人社团交错影响公共叙事',
        politics: '港务财团与市议会围绕无线电牌照相互施压',
        economy: '现金、工资与社会信用共同限制调查资源',
        combatScale: '危险短促且代价高，调查和撤退通常优先',
        deathRules: '死亡永久；精神与身体后果分开记录',
        careerRules: '职业由教育、执照、雇佣机构和社会网络决定',
        equipmentRules: '时代工具脆弱且用途具体，证据物不得变成通用加成',
        npcRules: '证词可能错误、隐瞒或受误导，但知识来源必须可追踪',
        traitRules: '调查优势必须伴随压力、偏见或社会代价',
        taboos: ['照搬受版权保护规则文本', '一次失败永久锁死核心线索', '现代数字设备'],
      },
      careers: [
        career(
          'night-archive-clerk',
          '夜渡档案员',
          '整理港务与电台历史记录',
          ['档案检索', '密码抄录'],
          ['文书', '证物'],
          '低薪但可接触官方记录',
        ),
        career(
          'signal-inspector',
          '民用信号检验员',
          '检查电台牌照与设备故障',
          ['无线电', '电气维修'],
          ['仪表', '执照'],
          '受市政技术处监管',
        ),
        career(
          'harbor-stringer',
          '港区特约记者',
          '追踪城市边缘新闻',
          ['采访', '摄影'],
          ['相机', '通讯录'],
          '依赖报社信用和匿名线人',
        ),
      ],
      equipment: [
        equipment(
          'folding-plate-camera',
          '折叠式板盒相机',
          'TOOL',
          '需要稳定支撑和显影时间的便携相机。',
          '生成可追溯影像证据，不提供战斗加成',
        ),
        equipment(
          'sealed-evidence-notebook',
          '封线证物簿',
          'CLUE',
          '逐页编号并可记录交接人的簿册。',
          '维持线索来源与交接链',
        ),
        equipment(
          'portable-valve-tester',
          '便携电子管测试器',
          'TOOL',
          '用于检测真空管状态的指针仪表。',
          '只适用于电台设备诊断',
        ),
      ],
      traits: [
        trait(
          'cold-reading',
          '冷读习惯',
          '善于捕捉谈话细节，却容易把巧合误当成模式。',
          'MIXED',
          -2,
          2,
        ),
        trait(
          'recurring-static-dream',
          '静电梦魇',
          '反复梦见相同呼号，但无法确认它是真实记忆。',
          'NARRATIVE',
          0,
          0,
        ),
      ],
      npcs: [
        npc(
          'evelyn',
          '伊芙琳',
          '潮痕咖啡馆夜班经理',
          '敏锐而防备媒体',
          '找回失踪的弟弟',
          '她删去了一次私人电话记录',
          '不知道观测站封条被替换',
        ),
        npc(
          'rhodes',
          '罗兹',
          '海雾观测站值夜员',
          '拘谨、依赖程序',
          '保住即将裁撤的岗位',
          '他把异常噪声归档到错误日期',
          '不知道伊芙琳的家庭关系',
        ),
        npc(
          'min',
          '敏恩',
          '地方晚报记者',
          '急切但重视可核实来源',
          '抢在竞争报社前发表调查',
          '她收到过匿名资助',
          '不知道磁带原始录制地点',
        ),
      ],
      quests: [
        quest(
          'blank-frequency',
          '凌晨两点的空白频段',
          '确定异常呼号的设备、时间与传播路径',
          '关键设备会在牌照审查前被转移',
          'MODERATE',
          'evelyn',
        ),
        quest(
          'blacked-tide-table',
          '被涂黑的潮位表',
          '恢复被覆盖的潮位记录并验证动机',
          '一名证人将因错误时间线被指控',
          'HIGH',
          'rhodes',
        ),
        quest(
          'missing-contact-sheet',
          '消失的照片接触印样',
          '找回报社暗房遗失的完整印样',
          '未经核实的照片会先行刊登',
          'LOW',
          'min',
        ),
      ],
      extension: extension(
        'investigation-resilience',
        '调查状态',
        [
          integerField('composure', '镇定', 0, 100),
          integerField('fortune', '机运', 0, 100),
          integerField('credit', '信用', 0, 100),
          integerField('clueLoad', '线索负荷', 0, 20),
        ],
        { composure: 62, fortune: 48, credit: 35, clueLoad: 0 },
      ),
      actions: investigationActions,
    }),
    cyberpunk: worldFixture({
      key: 'cyberpunk',
      displayName: '霓虹堤岸的断网夜',
      constitution: {
        worldType: '社区视角的近未来赛博都市',
        era: '二〇八九年海堤巨城的企业自治年代',
        technology: '神经接口、自治无人机、局域网格与模块化义体',
        magic: '不存在超自然魔法；异常必须有技术、社会或认知来源',
        peoples: ['自然人', '义体适配者', '离线社区居民'],
        society: '企业辖区、互助街区和平台劳工依赖不稳定基础设施',
        politics: '栖桥公司、市政残余与社区节点争夺网络控制权',
        economy: '信用点、配额、声望交换和维修债务共同流通',
        combatScale: '个人和小队行动；热度、弹药、负荷与医疗成本持续累积',
        deathRules: '死亡永久；人格备份不能等同本人复活',
        careerRules: '职业由接入权限、平台评级、街区关系和技能认证决定',
        equipmentRules: '义体占用插槽并累积负荷；装备价格和功率受本地规则约束',
        npcRules: 'NPC 拥有分层访问权限、派系利益和可追踪的信息来源',
        traitRules: '技术优势必须绑定热度、负荷、维护或关系代价',
        taboos: ['无成本全能黑客', '无限义体插槽', '数字人格无代价复活'],
      },
      careers: [
        career(
          'mesh-courier',
          '网格快递员',
          '在断续网络间运送实体密钥',
          ['路线规划', '反追踪'],
          ['运输', '隔离'],
          '依赖街区信誉的独立承包者',
        ),
        career(
          'clinic-patch-tech',
          '街诊修补师',
          '维护低配义体与离线医疗设备',
          ['义体维修', '创伤处置'],
          ['医疗', '工具'],
          '受社区保护也背负物资债',
        ),
        career(
          'civic-spectrum-auditor',
          '市频审计员',
          '追查无线频谱和企业授权滥用',
          ['信号分析', '合规取证'],
          ['扫描', '凭证'],
          '持有过期但仍有影响力的市政身份',
        ),
      ],
      equipment: [
        equipment(
          'cryogenic-signal-sleeve',
          '低温信号隔离套',
          'ARMOR',
          '包裹实体密钥并抑制短程追踪的冷却套。',
          '占用一个携行槽并降低一次追踪暴露',
        ),
        equipment(
          'folding-arc-wrench',
          '折叠电弧扳手',
          'TOOL',
          '可维修电力节点的低功率绝缘工具。',
          '只影响电力与义体维修检定',
        ),
        equipment(
          'scrubbed-access-shard',
          '净化访问片',
          'CLUE',
          '保留部分权限签名的离线存储片。',
          '可证明访问来源但会增加追踪热度',
        ),
      ],
      traits: [
        trait(
          'hot-swap-instinct',
          '热插拔直觉',
          '能快速切换接口协议，但会积累短时神经回响。',
          'MIXED',
          -3,
          3,
        ),
        trait(
          'neighborhood-debts',
          '街区欠账',
          '许多人愿意提供小帮助，也会要求兑现旧人情。',
          'NARRATIVE',
          0,
          0,
        ),
      ],
      npcs: [
        npc(
          'lan',
          '岚',
          '余温中继站修补师',
          '务实、对企业承诺怀疑',
          '让街区在断网后保持自治',
          '她留有一份备用网后门映射',
          '不知道密钥原主仍然在线',
        ),
        npc(
          'sato',
          '佐藤',
          '七码头街医',
          '温和但严格计算风险',
          '维持诊所的冷却配额',
          '他替一名公司逃员更换过身份芯片',
          '不知道中继站后门位置',
        ),
        npc(
          'kite',
          '鸢',
          '平台外卖骑手与消息掮客',
          '健谈、会保护长期客户',
          '提高街区声望以脱离平台债务',
          '他向两个派系出售过同一条路线',
          '不知道访问片真实权限',
        ),
      ],
      quests: [
        quest(
          'deliver-offline-key',
          '送达离线密钥',
          '在不泄露持有者的前提下完成密钥交接',
          '公司回收队将锁死社区备用网',
          'HIGH',
          'lan',
        ),
        quest(
          'last-node-heartbeat',
          '失联节点的最后心跳',
          '确认节点失联是故障、封锁还是背叛',
          '街区间互信和配额分配恶化',
          'EXTREME',
          'sato',
        ),
        quest(
          'ghost-route-ledger',
          '幽灵路线账本',
          '找出平台重复收费与路线篡改证据',
          '骑手债务继续自动增长',
          'MODERATE',
          'kite',
        ),
      ],
      extension: extension(
        'cyberpunk-augmentation',
        '义体与街区状态',
        [
          integerField('neuralLoad', '神经负荷', 0, 12),
          integerField('streetReputation', '街区声望', -100, 100),
          integerField('traceHeat', '追踪热度', 0, 10),
          textListField('implantSlots', '义体插槽', 6, 48),
          enumField('networkAccess', '网络权限', ['离线', '社区', '市政', '企业']),
        ],
        {
          neuralLoad: 2,
          streetReputation: 8,
          traceHeat: 0,
          implantSlots: ['神经桥'],
          networkAccess: '社区',
        },
      ),
      actions: cyberpunkActions,
    }),
  });

function worldFixture(input: {
  readonly key: PlaytestWorldKey;
  readonly displayName: string;
  readonly constitution: WorldConstitutionContent;
  readonly careers: readonly PlaytestCareerSeed[];
  readonly equipment: readonly PlaytestEquipmentSeed[];
  readonly traits: readonly CharacterTrait[];
  readonly npcs: readonly PlaytestNpcSeed[];
  readonly quests: readonly PlaytestQuestSeed[];
  readonly extension: PlaytestExtensionSeed;
  readonly actions: readonly ActionSeed[];
}): PlaytestWorldFixture {
  return Object.freeze({
    schemaVersion: 1,
    dataOrigin: 'SYNTHETIC_M11',
    key: input.key,
    campaignId: `playtest-m11-${input.key}`,
    displayName: input.displayName,
    constitution: Object.freeze(input.constitution),
    careers: Object.freeze(input.careers),
    equipment: Object.freeze(input.equipment),
    traits: Object.freeze(input.traits),
    npcs: Object.freeze(input.npcs),
    quests: Object.freeze(input.quests),
    extension: Object.freeze(input.extension),
    behaviorScript: Object.freeze(
      input.actions.map(([kind, actionInput], index) =>
        Object.freeze({
          sequence: index + 1,
          id: `${input.key}-${String(index + 1).padStart(2, '0')}`,
          kind,
          input: actionInput,
          requiredEvidence: requiredEvidenceFor(kind),
        }),
      ),
    ),
  });
}

function career(
  id: string,
  name: string,
  role: string,
  skills: readonly string[],
  equipmentTags: readonly string[],
  socialPosition: string,
): PlaytestCareerSeed {
  return Object.freeze({ id, name, role, skills, equipmentTags, socialPosition });
}

function equipment(
  id: string,
  name: string,
  category: PlaytestEquipmentSeed['category'],
  description: string,
  ruleHook: string,
): PlaytestEquipmentSeed {
  return Object.freeze({ id, name, category, description, ruleHook });
}

function trait(
  id: string,
  name: string,
  description: string,
  type: 'MIXED' | 'NARRATIVE',
  buffPoints: number,
  debuffPoints: number,
): CharacterTrait {
  return Object.freeze({
    id: `trait-playtest-${id}` as CharacterTrait['id'],
    name,
    description,
    pointProfile:
      type === 'NARRATIVE'
        ? Object.freeze({
            type,
            positiveEffect: null,
            negativeEffect: null,
            buffPoints,
            debuffPoints,
          })
        : Object.freeze({
            type,
            positiveEffect: `${name}的明确优势`,
            negativeEffect: `${name}的明确代价`,
            buffPoints,
            debuffPoints,
          }),
  });
}

function npc(
  id: string,
  name: string,
  identity: string,
  personality: string,
  goal: string,
  hiddenMotive: string,
  knowledgeBoundary: string,
): PlaytestNpcSeed {
  return Object.freeze({ id, name, identity, personality, goal, hiddenMotive, knowledgeBoundary });
}

function quest(
  id: string,
  title: string,
  objective: string,
  failureCost: string,
  risk: QuestRisk,
  publisherNpcId: string,
): PlaytestQuestSeed {
  return Object.freeze({ id, title, objective, failureCost, risk, publisherNpcId });
}

function extension(
  namespace: string,
  displayName: string,
  fields: readonly CharacterExtensionFieldDefinition[],
  initialValues: PlaytestExtensionSeed['initialValues'],
): PlaytestExtensionSeed {
  return Object.freeze({ namespace, displayName, fields: Object.freeze(fields), initialValues });
}

function integerField(
  key: string,
  label: string,
  minimum: number,
  maximum: number,
): CharacterExtensionFieldDefinition {
  return Object.freeze({ key, label, required: true, type: 'INTEGER', minimum, maximum });
}

function enumField(
  key: string,
  label: string,
  options: readonly string[],
): CharacterExtensionFieldDefinition {
  return Object.freeze({
    key,
    label,
    required: true,
    type: 'ENUM',
    options: Object.freeze(options),
  });
}

function textListField(
  key: string,
  label: string,
  maxItems: number,
  itemMaxLength: number,
): CharacterExtensionFieldDefinition {
  return Object.freeze({
    key,
    label,
    required: true,
    type: 'TEXT_LIST',
    maxItems,
    itemMaxLength,
  });
}

function requiredEvidenceFor(kind: PlaytestActionKind): readonly PlaytestEvidenceKind[] {
  const base: PlaytestEvidenceKind[] = ['OUTPUT', 'LATENCY', 'STATE_DIGEST'];
  if (kind === 'TALK_NPC' || kind === 'INSPECT_RUMOR') base.push('KNOWLEDGE_BOUNDARY');
  if (kind === 'ACCEPT_QUEST') base.push('QUEST_STATE');
  if (kind === 'D20_ACTION') base.push('D20_HARD_RESULT');
  if (kind === 'EQUIP_ITEM' || kind === 'TRADE') base.push('ECONOMY_EQUIPMENT');
  if (kind === 'TRAVEL' || kind === 'ADVANCE_TIME') base.push('WORLD_STATE');
  if (kind === 'SAVE_REOPEN') base.push('REOPEN_STATE');
  if (kind === 'FREE_INPUT') base.push('CONSEQUENCE');
  return Object.freeze(base);
}
