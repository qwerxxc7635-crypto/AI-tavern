import { type ContextCacheLayout } from '@ember-tavern/ai-core';

import { renderContextCacheLayout } from './context-cache-renderer.js';
import {
  renderStablePromptProfile,
  type StablePromptProfile,
} from './stable-prompt-profile.js';

export async function promptCachePrefixHash(
  stableProfile: StablePromptProfile,
  layout: ContextCacheLayout,
): Promise<string> {
  const semiStableLayout = Object.freeze({
    sections: Object.freeze(layout.sections.filter(({ stability }) => stability === 'semi_stable')),
  });
  const prefix = `${renderStablePromptProfile(stableProfile)}\n\n${renderContextCacheLayout(semiStableLayout)}`;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(prefix));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
