import { useCallback, useEffect, useRef, useState } from 'react';

import type { D20HardResultView } from './d20-hard-result.js';

const FALLBACK_DURATION_MS = 1_200;

export function D20Animation({
  result,
  onRevealed,
}: {
  readonly result: D20HardResultView;
  readonly onRevealed: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const completed = useRef(false);
  const mounted = useRef(true);

  const reveal = useCallback(() => {
    if (completed.current || !mounted.current) return;
    completed.current = true;
    setRevealed(true);
    onRevealed();
  }, [onRevealed]);

  useEffect(() => {
    mounted.current = true;
    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timeout = window.setTimeout(reveal, reducedMotion ? 0 : FALLBACK_DURATION_MS);
    return () => {
      mounted.current = false;
      window.clearTimeout(timeout);
    };
  }, [reveal]);

  return (
    <div className="d20-animation" aria-label="D20 检定结果" aria-live="polite">
      <p className="eyebrow">检定结果已锁定</p>
      <strong
        className={`d20-animation__die${revealed ? ' d20-animation__die--revealed' : ''}`}
        onAnimationEnd={reveal}
      >
        {result.raw}
      </strong>
      <p>
        原始 {result.raw} + 修正 {formatModifier(result.modifier)} = 总计 {result.total} / 难度{' '}
        {result.dc}
      </p>
      <em>{result.result === 'SUCCESS' ? '成功' : '失败'}</em>
      <small>动画仅展示已保存的结果；跳过、刷新或重放都不会重新投掷。</small>
      <button type="button" onClick={reveal} disabled={revealed}>
        {revealed ? '正在生成结果叙事…' : '跳过动画'}
      </button>
    </div>
  );
}

function formatModifier(modifier: number): string {
  return modifier >= 0 ? `+${modifier}` : String(modifier);
}
