import { schemaVersion } from '@ember-tavern/contracts';

const sharedSchema = schemaVersion(1);

export function TavernPage() {
  return (
    <SectionPage
      eyebrow="Home fire"
      title="酒馆"
      description="这里将成为旅途之间的落脚点。存档入口会在下一项任务接入。"
      note={`共享协议 Schema v${sharedSchema}`}
    />
  );
}

export function QuestsPage() {
  return (
    <SectionPage
      eyebrow="Quest ledger"
      title="任务"
      description="已知委托与当前目标将在后续页面任务中从本地存档读取。"
    />
  );
}

export function AdventurePage() {
  return (
    <SectionPage
      eyebrow="On the road"
      title="冒险"
      description="剧情、行动与本地骰点将在专属纵向切片中呈现。"
    />
  );
}

export function CharacterPage() {
  return (
    <SectionPage
      eyebrow="Character folio"
      title="角色"
      description="角色属性、背景和装备会从SQLite中的当前存档恢复。"
    />
  );
}

export function SettingsPage() {
  return (
    <SectionPage
      eyebrow="Local preferences"
      title="设置"
      description="模型、隐私与本地选项将在对应任务中逐项开放。"
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
