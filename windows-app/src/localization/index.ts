import { zhCN, type ZhCNResources } from './zh-CN.js';

export const ACTIVE_LOCALE = 'zh-CN' as const;
export const playerText: ZhCNResources = zhCN;

export function installDocumentLocale(documentValue: Document): void {
  documentValue.documentElement.lang = ACTIVE_LOCALE;
}
