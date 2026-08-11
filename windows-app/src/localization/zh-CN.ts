export const zhCN = Object.freeze({
  common: Object.freeze({
    brandName: 'Ember Tavern',
    brandSubtitle: '炉火酒馆',
    localOffline: '本地离线',
    backToTavern: '返回酒馆',
  }),
  navigation: Object.freeze({
    ariaLabel: '主导航',
    tavern: '酒馆',
    quests: '任务',
    adventure: '冒险',
    character: '角色',
    archives: '档案',
    my: '我的',
    npcDialogue: 'NPC 对话',
    modelSettings: '模型设置',
  }),
  titlebar: Object.freeze({
    eyebrow: '当前位置',
    unknownRoute: '未知路径',
    localSession: '本地会话',
    campaign: (shortId: string) => `存档 ${shortId}`,
  }),
  loading: Object.freeze({
    eyebrow: '正在准备',
    title: '正在整理桌面…',
    description: '本地内容加载完成后会自动继续。',
  }),
  routeUnavailable: Object.freeze({
    eyebrow: '路径不可用',
    title: '这条路还没有点灯。',
    description: '返回酒馆，继续查看当前可用内容。',
  }),
  pageUnavailable: Object.freeze({
    eyebrow: '页面不可用',
    title: '这个页面暂时无法打开。',
    description: '游戏数据没有被修改。切换到其他页面后可以再次尝试。',
  }),
  archiveDialog: Object.freeze({
    filterName: 'Ember Tavern 存档',
    importTitle: '导入 Ember Tavern 存档',
    exportTitle: '导出 Ember Tavern 存档',
  }),
  coreUi: Object.freeze({
    modelWorkshop: '模型工坊',
    connectionProfileLabel: '连接配置',
    apiBindingPhase: (phase: string) => apiBindingPhaseLabel(phase),
    modelPrivacySummary:
      '当前版本的游戏内容由本地演示模型生成；保存默认或备用模型不会发送游戏存档内容。',
    localProfile: '本机档案',
    connectionProfiles: '连接配置',
    modelRouting: '模型路由',
    generationProfile: '生成配置',
    promptCache: '提示词缓存',
    contextAssembly: '上下文装配',
    localFirstBoundaries: '本地优先边界',
    releaseMetadata: '发布信息',
    preparingRoad: '正在准备旅途',
    adventureReady: '冒险准备就绪',
    character: '角色',
    objective: '目标',
    worldClocks: '世界时钟',
    adventureEnding: '冒险终章',
    items: '物品',
    clues: '线索',
    lastRoll: '最近一次投骰',
    adventureUnavailable: '冒险不可用',
    adventureTurn: (turn: number) => `第 ${turn} 回合 · 本地编年史`,
    recoveryCenter: '恢复中心',
    lightingHearth: '正在点亮炉火',
    localChronicle: '本地编年史',
    returnedStories: '归来的故事',
    peopleByFire: '炉火旁的人们',
    selectedPatron: '当前选择的客人',
    whispers: '传闻',
    questBoard: '任务告示',
    worldPressure: '世界压力',
    tavernUnavailable: '酒馆不可用',
    missingChronicle: '缺少存档',
    readingAtlas: '正在读取地图册',
    worldBibleReview: '世界设定审阅',
    fieldLocks: '字段锁定',
    refineLocally: '局部调整',
    storyHooks: '故事钩子',
    worldStageUnavailable: '世界构筑阶段不可用',
    worldCreationStep: '第 01 步 · 世界构筑',
    shapeNewRealm: '塑造新世界',
    worldReference: '世界资料',
    readingNoticeBoard: '正在查看任务告示',
    questBoardUnavailable: '任务告示不可用',
    homeFire: '归处炉火',
    questLedger: '任务记录',
    onRoad: '旅途之中',
    characterFolio: '角色档案',
    readingCharacterSheet: '正在读取角色卡',
    characterReady: '角色已就绪',
    background: '背景',
    startingKit: '初始装备',
    chooseTwoTraits: '选择两个特质',
    buildTraveler: '塑造旅人',
    characterStageUnavailable: '角色创建阶段不可用',
    openingConversation: '正在开始交谈',
    conversationByFire: '炉火旁的交谈',
    relationship: '关系',
    firstImpression: '第一印象',
    conversationUnavailable: '对话不可用',
    localChronicles: '本地存档',
    portableArchive: '可移植存档',
    noChroniclesYet: '尚无存档',
    storyArchive: '故事档案',
    releaseState: (channel: string, status: string) =>
      `${releaseChannelLabel(channel)} / ${releaseStatusLabel(status)}`,
  }),
});

export type ZhCNResources = typeof zhCN;

function releaseChannelLabel(channel: string): string {
  return channel === 'development' ? '开发频道' : '未知频道';
}

function apiBindingPhaseLabel(phase: string): string {
  switch (phase) {
    case 'editing':
      return '编辑中';
    case 'testing':
      return '测试连接中';
    case 'choosing_model':
      return '选择模型';
    case 'saving':
      return '保存中';
    case 'saved':
      return '已保存';
    case 'failed':
      return '失败';
    default:
      return '未知状态';
  }
}

function releaseStatusLabel(status: string): string {
  return status === 'unreleased' ? '未发布' : '未知状态';
}
