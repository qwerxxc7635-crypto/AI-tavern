// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Progress,
  Select,
  Skeleton,
  Tabs,
  Textarea,
  Toast,
  Tooltip,
} from './primitives.js';

afterEach(cleanup);

describe('UI primitives', () => {
  it('keeps buttons native, disabled while loading, and named by visible status', () => {
    const action = vi.fn();
    const { rerender } = render(<Button onClick={action}>保存</Button>);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(action).toHaveBeenCalledOnce();

    rerender(
      <Button loading loadingLabel="正在保存" onClick={action}>
        保存
      </Button>,
    );
    const loading = screen.getByRole('button', { name: '正在保存' });
    expect(loading.hasAttribute('disabled')).toBe(true);
    expect(loading.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(loading);
    expect(action).toHaveBeenCalledOnce();
  });

  it('associates labels, descriptions, errors and invalid state for every field type', () => {
    render(
      <>
        <Input label="姓名" description="角色公开称呼" error="姓名不能为空" />
        <Textarea label="背景" description="只写角色已知内容" />
        <Select label="语气" error="请选择语气" defaultValue="">
          <option value="">请选择</option>
          <option value="steady">沉稳</option>
        </Select>
      </>,
    );

    const input = screen.getByRole('textbox', { name: '姓名' });
    const textarea = screen.getByRole('textbox', { name: '背景' });
    const select = screen.getByRole('combobox', { name: '语气' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain('-description');
    expect(input.getAttribute('aria-describedby')).toContain('-error');
    expect(textarea.getAttribute('aria-invalid')).toBeNull();
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getAllByRole('alert').map((node) => node.textContent)).toEqual([
      '姓名不能为空',
      '请选择语气',
    ]);
  });

  it('gives cards a programmatic title and stable structural snapshot', () => {
    const { container } = render(
      <Card title="任务" description="尚未接受" footer={<Button>查看</Button>}>
        护送商队
      </Card>,
    );
    const card = screen.getByRole('region', { name: '任务' });
    expect({
      tag: card.tagName,
      named: card.hasAttribute('aria-labelledby'),
      children: [...card.children].map(({ className }) => className),
      text: container.textContent,
    }).toMatchInlineSnapshot(`
      {
        "children": [
          "ui-card__header",
          "ui-card__content",
          "ui-card__footer",
        ],
        "named": true,
        "tag": "SECTION",
        "text": "任务尚未接受护送商队查看",
      }
    `);
  });

  it('opens a named modal, focuses its initial control and reports close intents', () => {
    const close = vi.fn();
    const focus = createRef<HTMLButtonElement>();
    render(
      <Modal
        open
        title="确认写入"
        description="确认后才会更新本地事实。"
        onClose={close}
        initialFocusRef={focus}
      >
        <Button ref={focus}>确认</Button>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { name: '确认写入' });
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(screen.getByRole('button', { name: '确认' })).toBe(document.activeElement);
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    expect(close).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('restores focus to the invoking control after a modal closes', () => {
    render(<ModalHarness />);
    const trigger = screen.getByRole('button', { name: '打开确认' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '确认' }).getAttribute('aria-modal')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(trigger).toBe(document.activeElement);
  });

  it('uses the same dialog contract for a right-side drawer', () => {
    render(
      <Drawer open title="详情" onClose={() => undefined}>
        内容
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: '详情' }).className).toContain('ui-dialog--drawer');
  });

  it('implements roving keyboard tabs and skips disabled items', () => {
    render(<TabsHarness />);
    const first = screen.getByRole('tab', { name: '概要' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const third = screen.getByRole('tab', { name: '记录' });
    expect(third.getAttribute('aria-selected')).toBe('true');
    expect(third).toBe(document.activeElement);
    fireEvent.keyDown(third, { key: 'Home' });
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(first).toBe(document.activeElement);
    expect(screen.getByRole('tabpanel').textContent).toBe('概要内容');
  });

  it('connects tooltip content to its native trigger', () => {
    render(
      <Tooltip content="查看本地记录">
        <button type="button">记录</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: '记录' });
    const tooltip = screen.getByRole('tooltip');
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);
  });

  it('announces ordinary and error toasts with appropriate urgency', () => {
    const { rerender } = render(<Toast title="已保存" description="只保存在本机" />);
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    rerender(<Toast title="保存失败" tone="error" />);
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive');
  });

  it('exposes skeleton loading text without exposing decorative lines', () => {
    const { container } = render(<Skeleton label="正在载入任务" lines={4} />);
    expect(screen.getByRole('status').textContent).toBe('正在载入任务');
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(container.querySelectorAll('[aria-hidden="true"] > span')).toHaveLength(4);
  });

  it('uses native progress semantics and validates bounds', () => {
    render(<Progress label="生成进度" value={2} max={5} description="正在验证" />);
    const progress = screen.getByRole('progressbar', { name: '生成进度' });
    expect(progress.getAttribute('value')).toBe('2');
    expect(screen.getByText('40%').getAttribute('aria-hidden')).toBe('true');
    expect(() => render(<Progress label="错误" value={6} max={5} />)).toThrow(
      'Progress value is invalid',
    );
  });

  it('keeps empty information calm and errors assertive', () => {
    render(
      <>
        <EmptyState title="还没有任务" description="稍后可在任务板生成。" />
        <ErrorState title="无法写入" description="本地事实没有改变。" code="PERSISTENCE" />
      </>,
    );
    expect(screen.getByRole('heading', { name: '还没有任务' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('PERSISTENCE');
  });
});

function TabsHarness() {
  const [activeId, setActiveId] = useState('summary');
  return (
    <Tabs
      label="角色详情"
      activeId={activeId}
      onChange={setActiveId}
      tabs={[
        { id: 'summary', label: '概要', panel: '概要内容' },
        { id: 'secret', label: '秘密', panel: '不可见', disabled: true },
        { id: 'history', label: '记录', panel: '记录内容' },
      ]}
    />
  );
}

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>打开确认</Button>
      <Modal open={open} title="确认" onClose={() => setOpen(false)}>
        内容
      </Modal>
    </>
  );
}
