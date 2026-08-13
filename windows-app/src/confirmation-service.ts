import { confirm } from '@tauri-apps/plugin-dialog';

export async function confirmPlayerAction(message: string): Promise<boolean> {
  if (!('__TAURI_INTERNALS__' in window)) return window.confirm(message);
  return confirm(message, {
    title: 'Ember Tavern',
    kind: 'warning',
    okLabel: '确认',
    cancelLabel: '取消',
  });
}
