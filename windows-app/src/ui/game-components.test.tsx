// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ActionComposer,
  AIFieldAssist,
  CharacterCard,
  DialogueView,
  GenerationPanel,
  ItemCard,
  NpcCard,
  QuestCard,
  StatusPanel,
  TraitCard,
} from './game-components.js';

afterEach(cleanup);

describe('shared game components', () => {
  it('renders five card view models and emits only explicit selection actions', () => {
    const npc = vi.fn();
    const quest = vi.fn();
    const trait = vi.fn();
    render(
      <>
        <CharacterCard
          character={{ id: 'pc', name: '岚', className: '游侠', summary: '寻找失踪的导师' }}
        />
        <NpcCard
          selected
          onSelect={npc}
          npc={{ id: 'npc', name: '米拉', identity: '老板', mood: '沉稳' }}
        />
        <TraitCard
          selected={false}
          onSelect={trait}
          trait={{ id: 'trait', name: '警觉', description: '更早发现危险' }}
        />
        <QuestCard
          onSelect={quest}
          quest={{
            id: 'quest',
            title: '失踪商队',
            summary: '沿旧路寻找线索',
            risk: '中等',
            publisher: '商会',
            status: '可接受',
          }}
        />
        <ItemCard
          item={{
            id: 'item',
            name: '旧地图',
            description: '标出一条山路',
            category: '线索',
            quantity: 1,
          }}
        />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: /米拉/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /警觉/ }));
    fireEvent.click(screen.getByRole('button', { name: /失踪商队/ }));
    expect(npc).toHaveBeenCalledOnce();
    expect(trait).toHaveBeenCalledWith(true);
    expect(quest).toHaveBeenCalledOnce();
    expect(screen.getByRole('article', { name: '岚' })).toBeTruthy();
    expect(screen.getByRole('article', { name: '旧地图' })).toBeTruthy();
  });

  it('renders dialogue content plus empty, loading and safe error states', () => {
    const { rerender } = render(
      <DialogueView
        label="对话历史"
        emptyText="可以先开口。"
        messages={[{ id: 'one', speaker: '你', content: '晚上好。', side: 'PLAYER' }]}
      />,
    );
    expect(screen.getByLabelText('对话历史').textContent).toContain('晚上好。');

    rerender(<DialogueView label="对话历史" emptyText="可以先开口。" messages={[]} />);
    expect(screen.getByRole('heading', { name: '还没有对话' })).toBeTruthy();
    rerender(<DialogueView label="对话历史" emptyText="可以先开口。" messages={[]} loading />);
    expect(screen.getByRole('status').textContent).toBe('正在整理对话');
    rerender(
      <DialogueView
        label="对话历史"
        emptyText="可以先开口。"
        messages={[]}
        error="本地记录未改变"
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('本地记录未改变');
  });

  it('keeps ActionComposer suggestions and free input on explicit callbacks', () => {
    const change = vi.fn();
    const suggestion = vi.fn();
    const submit = vi.fn();
    const { rerender } = render(
      <ActionComposer
        label="自由行动"
        description="建议不是限制"
        value=""
        suggestions={[{ id: 'look', label: '观察门锁' }]}
        submitLabel="提交行动"
        onChange={change}
        onSuggestion={suggestion}
        onSubmit={submit}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '观察门锁' }));
    fireEvent.change(screen.getByRole('textbox', { name: '自由行动' }), {
      target: { value: '敲门' },
    });
    expect(suggestion).toHaveBeenCalledWith({ id: 'look', label: '观察门锁' });
    expect(change).toHaveBeenCalledWith('敲门');
    expect(screen.getByRole('button', { name: '提交行动' }).hasAttribute('disabled')).toBe(true);

    rerender(
      <ActionComposer
        label="自由行动"
        description="建议不是限制"
        value="敲门"
        suggestions={[]}
        submitLabel="提交行动"
        onChange={change}
        onSuggestion={suggestion}
        onSubmit={submit}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '提交行动' }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('presents field assistance states without owning field or persistence state', () => {
    const generate = vi.fn();
    const apply = vi.fn();
    const { rerender } = render(<AIFieldAssist state="IDLE" onGenerate={generate} />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 辅助' }));
    expect(generate).toHaveBeenCalledOnce();
    rerender(<AIFieldAssist state="CANDIDATE" candidate="更简洁的背景" onApply={apply} />);
    fireEvent.click(screen.getByRole('button', { name: '采用候选' }));
    expect(apply).toHaveBeenCalledOnce();
    expect(screen.getByText('更简洁的背景')).toBeTruthy();
  });

  it('shows bounded generation and status projections with retry/cancel intents', () => {
    const retry = vi.fn();
    const cancel = vi.fn();
    render(
      <>
        <GenerationPanel
          title="生成世界"
          stages={[
            { id: 'context', label: '整理上下文', state: 'COMPLETE' },
            { id: 'validate', label: '验证结果', state: 'ERROR' },
          ]}
          onRetry={retry}
          onCancel={cancel}
        />
        <StatusPanel
          title="当前状态"
          items={[{ id: 'health', label: '生命', value: '8/10', tone: 'positive' }]}
        />
      </>,
    );
    expect(screen.getByRole('progressbar', { name: '生成进度' }).getAttribute('value')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(screen.getByRole('region', { name: '当前状态' }).textContent).toContain('8/10');
  });
});
