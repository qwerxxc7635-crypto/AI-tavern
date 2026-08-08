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
});

export type ZhCNResources = typeof zhCN;
