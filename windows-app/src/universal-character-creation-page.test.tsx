// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import {
  campaignId,
  characterTraitId,
  createCharacterCreationSession,
  createUniversalCharacterDraft,
  createWorldCharacterExtensionDefinition,
  generationRecordId,
  isoTimestamp,
  playerCharacterId,
  stageQuickCharacterDraft,
  type CharacterCreationSession,
} from '@ember-tavern/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CharacterCreationPage } from './universal-character-creation-page.js';
import { UNIVERSAL_CHARACTER_AI_FIELDS } from './universal-character-ai.js';
import type { UniversalCharacterCreationSnapshot } from './universal-character-creation-service.js';

const campaignKey = campaignId('campaign-page-v3');
const characterKey = playerCharacterId('character-page-v3');
const at = isoTimestamp('2026-08-20T03:00:00.000Z');
const definition = createWorldCharacterExtensionDefinition({
  schemaVersion: 1,
  campaignId: campaignKey,
  namespace: 'investigation',
  displayName: '调查世界字段',
  constitutionRevision: 1,
  fields: [
    { key: 'calling', label: '执念', required: false, type: 'TEXT', maxLength: 200 },
    { key: 'sanity', label: '理智', required: true, type: 'INTEGER', minimum: 0, maximum: 100 },
  ],
  revision: 1,
  createdAt: at,
  updatedAt: at,
});

afterEach(() => {
  cleanup();
});

describe('Universal Character Creation page', () => {
  it('starts Quick from one concept and exposes generation without writing formal facts', async () => {
    const empty = snapshot(null);
    const active = snapshot(session('QUICK', 'ACTIVE'));
    const service = actions(empty);
    service.start.mockResolvedValue(active);
    renderPage(service);

    expect(await screen.findByText('写下一位会在这个世界里活起来的人。')).toBeDefined();
    fireEvent.change(screen.getByLabelText('一句话角色概念'), {
      target: { value: '追查失踪导师的落魄调查员' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始创建' }));

    await waitFor(() => expect(service.start).toHaveBeenCalledOnce());
    expect(service.start).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: campaignKey,
        mode: 'QUICK',
        conceptInput: '追查失踪导师的落魄调查员',
      }),
    );
    expect(
      (await screen.findByRole('button', { name: '命运编织完整角色' })).hasAttribute('disabled'),
    ).toBe(false);
    expect(screen.getByText(/确认前不会创建正式角色事实/)).toBeDefined();
  });

  it('renders all universal groups and dynamic fields in Advanced, then saves before preparing', async () => {
    const activeSession = session('ADVANCED', 'ACTIVE');
    const savedSession = { ...activeSession, revision: 2 };
    const active = snapshot(activeSession);
    const saved = snapshot(savedSession);
    const ready = snapshot({ ...savedSession, status: 'READY_TO_CONFIRM', revision: 3 });
    const service = actions(active);
    service.saveDraft.mockResolvedValue(saved);
    service.prepareAdvanced.mockResolvedValue(ready);
    renderPage(service);

    expect(await screen.findByText('每一项都仍是可恢复的草稿。')).toBeDefined();
    for (const field of [
      'name',
      'identity',
      'appearance',
      'personality',
      'values',
      'goals',
      'fears',
      'family',
      'education',
      'importantPeople',
      'enemies',
      'experiences',
      'career.legacyArchetype',
      'attributes.physique',
      'proficiencies',
      'abilities',
      'languages',
      'traits.0',
      'legacyBackground.formativeExperience',
      'contentBoundaries.excludedContent',
      'extensions.investigation.sanity',
    ]) {
      expect(document.querySelector(`[data-character-field="${field}"]`)).not.toBeNull();
    }
    for (const { path } of UNIVERSAL_CHARACTER_AI_FIELDS) {
      expect(document.querySelector(`[data-ai-field="character:${path}"]`)).not.toBeNull();
    }
    expect(
      document.querySelector('[data-ai-field="character:extensions.investigation.calling"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-ai-field="character:age"]')).toBeNull();
    expect(
      document.querySelector('[data-ai-field="character:extensions.investigation.sanity"]'),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '米拉·维尔' } });
    fireEvent.click(screen.getByRole('button', { name: '校验完整车卡' }));

    await waitFor(() => expect(service.saveDraft).toHaveBeenCalledOnce());
    expect(service.saveDraft.mock.calls[0]?.[1]).toMatchObject({ name: '米拉·维尔' });
    expect(service.prepareAdvanced).toHaveBeenCalledWith(saved);
    expect(await screen.findByText('角色已通过本地完整性校验。')).toBeDefined();
    expect(screen.getByRole('button', { name: '确认角色' }).hasAttribute('disabled')).toBe(false);

    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '尚未保存的新名字' } });
    expect(screen.getByRole('button', { name: '确认角色' }).hasAttribute('disabled')).toBe(true);
    expect(service.confirm).not.toHaveBeenCalled();
  });

  it('keeps whole-draft generation provisional and supports undo after adoption', async () => {
    const active = snapshot(session('ADVANCED', 'ACTIVE'));
    const original = active.session?.draft;
    if (original === undefined) throw new Error('Fixture draft missing');
    const service = actions(active);
    service.generateDraftPreview.mockResolvedValue({
      draft: { ...original, name: '命运改写的米拉' },
      changedPaths: ['name'],
    });
    renderPage(service);

    await screen.findByText('每一项都仍是可恢复的草稿。');
    fireEvent.click(screen.getByRole('button', { name: '协调整张车卡' }));
    await waitFor(() => expect(service.generateDraftPreview).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: '采用整批候选' })).toBeDefined();
    expect((screen.getByLabelText('姓名') as HTMLTextAreaElement).value).toBe('Mira Vale');

    fireEvent.click(screen.getByRole('button', { name: '采用整批候选' }));
    expect((screen.getByLabelText('姓名') as HTMLTextAreaElement).value).toBe('命运改写的米拉');
    fireEvent.click(screen.getByRole('button', { name: '撤销整批采用' }));
    expect((screen.getByLabelText('姓名') as HTMLTextAreaElement).value).toBe('Mira Vale');
  });

  it('recomputes Trait points locally, blocks non-zero start and accepts the empty collection', async () => {
    const active = snapshot(session('ADVANCED', 'ACTIVE'));
    const service = actions(active);
    renderPage(service);

    expect(await screen.findByText('本地重算：0（可开始）')).toBeDefined();
    const typeSelectors = screen.getAllByLabelText('特质类型');
    const [firstType, secondType] = typeSelectors;
    if (firstType === undefined || secondType === undefined) {
      throw new Error('page must render two Trait type selectors');
    }
    fireEvent.change(firstType, { target: { value: 'BUFF' } });
    expect(screen.getByText('本地重算：-1（禁止开始）')).toBeDefined();
    expect(
      (screen.getByRole('button', { name: '校验完整车卡' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: '保存草稿' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(
      document.querySelector('[data-ai-field="character:traits.0.pointProfile.positiveEffect"]'),
    ).not.toBeNull();

    fireEvent.change(secondType, { target: { value: 'DEBUFF' } });
    expect(screen.getByText('本地重算：0（可开始）')).toBeDefined();
    expect(
      (screen.getByRole('button', { name: '校验完整车卡' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      document.querySelector('[data-ai-field="character:traits.1.pointProfile.negativeEffect"]'),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '移除特质 1' }));
    fireEvent.click(screen.getByRole('button', { name: '移除特质 1' }));
    expect(screen.getByText('本地重算：0（可开始）')).toBeDefined();
    expect(screen.getByRole('button', { name: '添加特质' })).toBeDefined();
  });
});

function renderPage(service: ReturnType<typeof actions>) {
  return render(
    <MemoryRouter initialEntries={[`/character/create?campaignId=${campaignKey}`]}>
      <Routes>
        <Route path="/character/create" element={<CharacterCreationPage service={service} />} />
      </Routes>
    </MemoryRouter>,
  );
}

function actions(initial: UniversalCharacterCreationSnapshot) {
  return {
    load: vi.fn().mockResolvedValue(initial),
    start: vi.fn(),
    saveDraft: vi.fn(),
    switchMode: vi.fn(),
    prepareAdvanced: vi.fn(),
    generateQuick: vi.fn(),
    cancel: vi.fn(),
    resume: vi.fn(),
    confirm: vi.fn(),
    assistField: vi.fn(),
    generateDraftPreview: vi.fn(),
  };
}

function snapshot(
  sessionValue: CharacterCreationSession | null,
): UniversalCharacterCreationSnapshot {
  return {
    campaignState: 'CREATING_CHARACTER',
    constitution: {},
    extensionDefinitions: [definition],
    session: sessionValue,
  };
}

function session(mode: 'QUICK' | 'ADVANCED', status: 'ACTIVE' | 'READY_TO_CONFIRM') {
  const draft = completeDraft();
  const created = createCharacterCreationSession(
    {
      id: `session-page-${mode.toLowerCase()}`,
      campaignId: campaignKey,
      characterId: characterKey,
      constitutionRevision: 1,
      mode,
      conceptInput: mode === 'QUICK' ? '追查失踪导师的调查员' : null,
      draft,
      createdAt: at,
    },
    [definition],
  );
  return status === 'ACTIVE'
    ? created
    : stageQuickCharacterDraft(
        { ...created, mode: 'QUICK', conceptInput: '追查失踪导师的调查员' },
        draft,
        generationRecordId('generation-page-v3'),
        [definition],
        isoTimestamp('2026-08-20T03:01:00.000Z'),
      );
}

function completeDraft() {
  return createUniversalCharacterDraft({
    schemaVersion: 1,
    id: characterKey,
    campaignId: campaignKey,
    name: 'Mira Vale',
    nickname: null,
    gender: null,
    age: 27,
    identity: 'A disgraced investigator.',
    ancestry: 'Human',
    birthplace: 'Ash Harbor',
    socialClass: 'Former guild member',
    faith: null,
    appearance: 'A dark travel coat and a brass compass.',
    personality: 'Patient and unable to ignore contradictions.',
    values: ['Truth'],
    goals: ['Find the missing mentor'],
    fears: ['Following another false trail'],
    secrets: ['The compass answers to her blood'],
    family: ['The Vale household'],
    education: ['Harbor Academy'],
    importantPeople: ['Professor Aven'],
    enemies: ['The Ash Cartographer'],
    experiences: ['Survived a skyquake'],
    concept: 'A world-walking investigator.',
    storyPreferences: ['Mystery'],
    contentBoundaries: {
      allowHorror: true,
      allowPermanentDeath: false,
      allowRomance: true,
      allowBetrayal: true,
      excludedContent: [],
    },
    career: { id: null, displayName: 'World Walker', legacyArchetype: 'SCHOLAR' },
    attributes: { physique: 1, agility: 3, knowledge: 4, charisma: 2 },
    derivedAttributes: [],
    skills: [],
    proficiencies: ['Cartography'],
    abilities: ['Read the road'],
    languages: ['Common'],
    wealth: 0,
    equipmentIds: [],
    reputations: [],
    relationships: [],
    traits: [
      {
        id: characterTraitId('trait-page-observant'),
        name: 'Observant',
        description: 'Notices small inconsistencies.',
      },
      {
        id: characterTraitId('trait-page-restless'),
        name: 'Restless',
        description: 'Cannot leave a mystery alone.',
      },
    ],
    statuses: [],
    legacyBackground: {
      birthplace: 'Ash Harbor',
      formativeExperience: 'Survived a skyquake while mapping the north road.',
      adventureMotivation: 'Find the missing mentor.',
      secret: 'The compass answers to her blood.',
      importantPerson: 'Professor Aven',
      tavernArrivalReason: 'The compass points beneath Ember Rest.',
    },
    extensions: [{ namespace: 'investigation', schemaVersion: 1, values: { sanity: 63 } }],
  });
}
