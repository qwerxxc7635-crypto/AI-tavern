import { canonicalJson, type ContextCacheLayout } from '@ember-tavern/ai-core';

export function renderContextCacheLayout(layout: ContextCacheLayout): string {
  return layout.sections
    .map((section) => {
      const blocks = section.blocks.map((block) => ({
        type: block.type,
        sourceRevision: block.sourceRevision,
        version: block.version,
        contentHash: block.contentHash,
        content: block.content,
      }));
      return `[${section.kind}]\n${canonicalJson({ blocks })}`;
    })
    .join('\n\n');
}
