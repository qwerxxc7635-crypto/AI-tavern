import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  windowsSettlementService,
  type AdventureArchive,
  type WindowsSettlementService,
} from './settlement-service.js';
export function ArchivesPage({
  service = windowsSettlementService,
}: {
  readonly service?: Pick<WindowsSettlementService, 'list'>;
}) {
  const [search] = useSearchParams();
  const id = search.get('campaignId');
  const [archives, setArchives] = useState<readonly AdventureArchive[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (id === null) return;
    let active = true;
    void service
      .list(id)
      .then((v) => {
        if (active) setArchives(v);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [id, service]);
  if (id === null)
    return (
      <main className="system-state">
        <h1>档案</h1>
        <p>请先选择存档</p>
      </main>
    );
  if (failed)
    return (
      <main className="system-state" role="alert">
        <h1>档案读取失败</h1>
      </main>
    );
  if (archives === null)
    return (
      <main className="system-state" aria-busy="true">
        <h1>正在翻阅档案…</h1>
      </main>
    );
  return (
    <main className="archive-page">
      <header>
        <p className="eyebrow">Story archive</p>
        <h1>冒险档案</h1>
        <p>全部内容来自已提交的 SQLite 事实。</p>
      </header>
      {archives.length === 0 ? (
        <p className="archive-empty">尚无已结算冒险。</p>
      ) : (
        archives.map((a) => (
          <article className="archive-card" key={a.adventureId}>
            <p className="eyebrow">
              {a.outcome} · {new Date(a.completedAt).toLocaleDateString()}
            </p>
            <h2>{a.title}</h2>
            <p>{a.summary}</p>
            <h3>关键选择</h3>
            <ul>
              {a.keyDecisions.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <h3>骰子记录</h3>
            <ul>
              {a.diceResults.map((roll, index) => (
                <li key={`${a.adventureId}-roll-${index}`}>
                  D20 {roll.naturalRoll} · 总计 {roll.total}/{roll.difficulty} ·{' '}
                  {roll.success ? '成功' : '失败'}
                </li>
              ))}
            </ul>
            <h3>参与 NPC</h3>
            <p>{a.participantNpcs.map((npc) => npc.name).join('、')}</p>
            <h3>未解决线索</h3>
            {a.unresolvedClues.length === 0 ? (
              <p>无</p>
            ) : (
              <ul>
                {a.unresolvedClues.map((clue) => (
                  <li key={clue.id}>
                    {clue.title} — {clue.description}
                  </li>
                ))}
              </ul>
            )}
            <h3>酒馆变化</h3>
            <p>{a.tavernChange.description}</p>
            <h3>奖励与世界事实</h3>
            <ul>
              {a.acquiredItems.map((x) => (
                <li key={x.name}>
                  {x.name} — {x.description}
                </li>
              ))}
              {a.worldFacts.map((x) => (
                <li key={x.statement}>{x.statement}</li>
              ))}
            </ul>
            <h3>生成记录</h3>
            <ul>
              {a.generationUses.map((use) => (
                <li key={use.task}>
                  {use.task} · {use.modelName} · Prompt v{use.promptVersion}
                </li>
              ))}
            </ul>
            <h3>后续方向</h3>
            <ul>
              {a.nextDirections.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </article>
        ))
      )}
      <Link className="primary-action" to={`/tavern?campaignId=${encodeURIComponent(id)}`}>
        返回酒馆
      </Link>
    </main>
  );
}
