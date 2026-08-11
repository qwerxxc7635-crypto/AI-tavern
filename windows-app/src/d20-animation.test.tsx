// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { D20Animation } from './d20-animation.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'matchMedia');
});

const result = {
  raw: 12,
  modifier: 3,
  total: 15,
  dc: 11,
  result: 'SUCCESS',
  attributeModifier: 3,
  equipmentModifier: 0,
  statusModifier: 0,
} as const;

describe('D20Animation', () => {
  it('reveals a fixed result once when skipped or animation events repeat', () => {
    const revealed = vi.fn();
    render(<D20Animation result={result} onRevealed={revealed} />);

    expect(screen.getByText('原始 12 + 修正 +3 = 总计 15 / 难度 11')).toBeTruthy();
    const die = screen.getByText('12');
    fireEvent.click(screen.getByRole('button', { name: '跳过动画' }));
    fireEvent.animationEnd(die);
    fireEvent.animationEnd(die);

    expect(revealed).toHaveBeenCalledTimes(1);
  });

  it('reveals immediately for reduced motion', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true }) as MediaQueryList),
    });
    vi.useFakeTimers();
    const revealed = vi.fn();
    render(<D20Animation result={result} onRevealed={revealed} />);

    await vi.runAllTimersAsync();

    expect(revealed).toHaveBeenCalledTimes(1);
  });

  it('cancels the fallback when interrupted by unmounting', async () => {
    vi.useFakeTimers();
    const revealed = vi.fn();
    const view = render(<D20Animation result={result} onRevealed={revealed} />);

    view.unmount();
    await vi.runAllTimersAsync();

    expect(revealed).not.toHaveBeenCalled();
  });
});
