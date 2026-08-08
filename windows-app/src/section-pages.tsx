import { schemaVersion } from '@ember-tavern/contracts';

import { playerText } from './localization/index.js';

const sharedSchema = schemaVersion(1);

export function TavernPage() {
  return (
    <SectionPage
      eyebrow={playerText.coreUi.homeFire}
      title="酒馆"
      description="这里将成为旅途之间的落脚点。存档入口会在下一项任务接入。"
      note={`共享协议 Schema v${sharedSchema}`}
    />
  );
}

export function QuestsPage() {
  return (
    <SectionPage
      eyebrow={playerText.coreUi.questLedger}
      title="任务"
      description="已知委托与当前目标将在后续页面任务中从本地存档读取。"
    />
  );
}

export function AdventurePage() {
  return (
    <SectionPage
      eyebrow={playerText.coreUi.onRoad}
      title="冒险"
      description="剧情、行动与本地骰点将在专属纵向切片中呈现。"
    />
  );
}

export function CharacterPage() {
  return (
    <SectionPage
      eyebrow={playerText.coreUi.characterFolio}
      title="角色"
      description="角色属性、背景和装备会从SQLite中的当前存档恢复。"
    />
  );
}

interface SectionPageProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly note?: string;
}

function SectionPage({ eyebrow, title, description, note }: SectionPageProps) {
  return (
    <main className="section-page">
      <div className="section-page__index" aria-hidden="true">
        {title.slice(0, 1)}
      </div>
      <div className="section-page__copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
        {note === undefined ? null : <small>{note}</small>}
      </div>
      <p className="section-page__pending">页面功能将在对应任务中启用</p>
    </main>
  );
}
