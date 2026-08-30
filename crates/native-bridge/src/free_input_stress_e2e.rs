use std::{fs, path::Path};

use rusqlite::params;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    CampaignStore, DynamicLocationTravelCommand, FactionActionBudget, FactionActionCommand,
    FactionActionConsequence, FactionActionProposal, NpcDialogueCommit, QuestPoolTransitionCommand,
    TavernGenerationAudit,
};

const FANTASY_CAMPAIGN: &str = "playtest-m11-fantasy";
const INVESTIGATION_CAMPAIGN: &str = "playtest-m11-investigation";
const CYBERPUNK_CAMPAIGN: &str = "playtest-m11-cyberpunk";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StressAction {
    sequence: usize,
    id: String,
    world: String,
    category: String,
    input: String,
    expected_outcome: String,
}

#[test]
fn persists_cross_world_free_input_success_failure_and_refusal() {
    const ENVIRONMENT: [&str; 4] = [
        "EMBER_FREE_INPUT_FANTASY_DATABASE",
        "EMBER_FREE_INPUT_INVESTIGATION_DATABASE",
        "EMBER_FREE_INPUT_CYBERPUNK_DATABASE",
        "EMBER_FREE_INPUT_STRESS_SCRIPT",
    ];
    let configured = ENVIRONMENT
        .iter()
        .filter(|name| std::env::var_os(name).is_some())
        .count();
    if configured == 0 {
        return;
    }
    assert_eq!(
        configured,
        ENVIRONMENT.len(),
        "free-input stress integration requires all four environment paths"
    );

    let fantasy_path = required_path("EMBER_FREE_INPUT_FANTASY_DATABASE");
    let investigation_path = required_path("EMBER_FREE_INPUT_INVESTIGATION_DATABASE");
    let cyberpunk_path = required_path("EMBER_FREE_INPUT_CYBERPUNK_DATABASE");
    let script_path = required_path("EMBER_FREE_INPUT_STRESS_SCRIPT");
    let script: Vec<StressAction> =
        serde_json::from_slice(&fs::read(&script_path).expect("read free-input stress script"))
            .expect("parse free-input stress script");
    assert_eq!(script.len(), 8);
    assert!(script.iter().enumerate().all(|(index, action)| {
        action.sequence == index + 1
            && !action.world.is_empty()
            && !action.category.is_empty()
            && !action.input.is_empty()
            && !action.expected_outcome.is_empty()
    }));

    refuse_quest(&fantasy_path, action_input(&script, "fantasy-refuse-quest"));
    deceive_publisher(
        &investigation_path,
        action_input(&script, "investigation-deceive-publisher"),
    );
    attempt_tavern_purchase(&fantasy_path, action_input(&script, "fantasy-buy-tavern"));
    attempt_theft(&fantasy_path, action_input(&script, "fantasy-steal"));
    leave_town(
        &investigation_path,
        action_input(&script, "investigation-leave-town"),
    );
    continue_passerby_dialogue(
        &investigation_path,
        action_input(&script, "investigation-long-talk"),
    );
    attempt_quest_item_sale(
        &cyberpunk_path,
        action_input(&script, "cyberpunk-sell-quest-item"),
    );
    defect_to_enemy(&cyberpunk_path, action_input(&script, "cyberpunk-defect"));

    verify_and_export(&fantasy_path, FANTASY_CAMPAIGN);
    verify_and_export(&investigation_path, INVESTIGATION_CAMPAIGN);
    verify_and_export(&cyberpunk_path, CYBERPUNK_CAMPAIGN);
}

fn refuse_quest(database_path: &Path, player_input: &str) {
    let store = CampaignStore::open(database_path).expect("open fantasy stress save");
    let owner_id = owner_id(&store, FANTASY_CAMPAIGN);
    commit_dialogue(
        &store,
        FANTASY_CAMPAIGN,
        &owner_id,
        "fantasy-refuse-quest",
        player_input,
        "你可以拒绝这份誓约；我会把它从你的承诺中撤下，但港口不会忘记这条路仍然无人处理。",
        "克制",
        json!({"trust":-1}),
    );
    let (quest_id, revision) = accepted_quest(&store, FANTASY_CAMPAIGN);
    let snapshot = store
        .transition_quest_pool(QuestPoolTransitionCommand {
            campaign_id: FANTASY_CAMPAIGN.to_owned(),
            quest_id: quest_id.clone(),
            expected_revision: revision,
            to_status: "ABANDONED".to_owned(),
            source: "PLAYER".to_owned(),
            reason: "玩家明确拒绝继续尚未完成的委托。".to_owned(),
            operation_id: "m11-free-input-refuse-quest".to_owned(),
        })
        .expect("persist player quest refusal");
    assert!(
        snapshot
            .quests
            .iter()
            .any(|quest| quest.id == quest_id && quest.status == "ABANDONED")
    );
}

fn deceive_publisher(database_path: &Path, player_input: &str) {
    let store = CampaignStore::open(database_path).expect("open investigation stress save");
    let owner_id = owner_id(&store, INVESTIGATION_CAMPAIGN);
    let before = relationship_trust(&store, &owner_id);
    let snapshot = commit_dialogue(
        &store,
        INVESTIGATION_CAMPAIGN,
        &owner_id,
        "investigation-deceive-publisher",
        player_input,
        "这套说辞和已登记的交接时间矛盾。我不会据此指控任何人，也会把你的可信度下降记录下来。",
        "怀疑",
        json!({"trust":-1}),
    );
    assert_eq!(snapshot.relationship.trust, before - 1);
}

fn attempt_tavern_purchase(database_path: &Path, player_input: &str) {
    let store = CampaignStore::open(database_path).expect("reopen fantasy stress save");
    let owner_before = owner_id(&store, FANTASY_CAMPAIGN);
    let money_before = money(&store, FANTASY_CAMPAIGN);
    commit_dialogue(
        &store,
        FANTASY_CAMPAIGN,
        &owner_before,
        "fantasy-buy-tavern",
        player_input,
        "断梁酒馆不出售。你现有的银币也不能绕过契约、住客和港务议会的共同权利。",
        "坚定",
        json!({}),
    );
    assert_eq!(owner_id(&store, FANTASY_CAMPAIGN), owner_before);
    assert_eq!(money(&store, FANTASY_CAMPAIGN), money_before);
}

fn attempt_theft(database_path: &Path, player_input: &str) {
    let store = CampaignStore::open(database_path).expect("reopen fantasy theft save");
    let owner_id = owner_id(&store, FANTASY_CAMPAIGN);
    let trust_before = relationship_trust(&store, &owner_id);
    let money_before = money(&store, FANTASY_CAMPAIGN);
    let snapshot = commit_dialogue(
        &store,
        FANTASY_CAMPAIGN,
        &owner_id,
        "fantasy-steal",
        player_input,
        "你伸手前就被柜台后的镜片照见。钱匣没有打开，玛菈叫来守卫并收回一分信任。",
        "戒备",
        json!({"trust":-1}),
    );
    assert_eq!(snapshot.relationship.trust, trust_before - 1);
    assert_eq!(money(&store, FANTASY_CAMPAIGN), money_before);
}

fn leave_town(database_path: &Path, player_input: &str) {
    let store = CampaignStore::open(database_path).expect("reopen investigation travel save");
    let owner_id = owner_id(&store, INVESTIGATION_CAMPAIGN);
    commit_dialogue(
        &store,
        INVESTIGATION_CAMPAIGN,
        &owner_id,
        "investigation-leave-town",
        player_input,
        "你可以离开雾港；观测站仍与这里相连，但未完成的调查不会因你出城而自动解决。",
        "审慎",
        json!({}),
    );
    let before = store
        .dynamic_location_snapshot(INVESTIGATION_CAMPAIGN)
        .expect("load investigation location graph");
    let target = before
        .locations
        .iter()
        .find(|location| location.id != before.state.current_location_id)
        .expect("investigation has an adjacent out-of-town location")
        .id
        .clone();
    let after = store
        .travel_dynamic_location(DynamicLocationTravelCommand {
            campaign_id: INVESTIGATION_CAMPAIGN.to_owned(),
            target_location_id: target.clone(),
            expected_revision: before.state.revision,
            mode: "ROAD".to_owned(),
            event_id: "m11-free-input-leave-town-event".to_owned(),
            operation_id: "m11-free-input-leave-town-operation".to_owned(),
        })
        .expect("persist free-input departure");
    assert_eq!(after.state.current_location_id, target);
    assert_eq!(after.state.revision, before.state.revision + 1);
}

fn continue_passerby_dialogue(database_path: &Path, player_input: &str) {
    let passerby_id = {
        let store = CampaignStore::open(database_path).expect("open passerby dialogue save");
        npc_id_by_name(&store, INVESTIGATION_CAMPAIGN, "早班邮差")
    };
    let first_count = {
        let store = CampaignStore::open(database_path).expect("reopen passerby first turn");
        let snapshot = commit_dialogue(
            &store,
            INVESTIGATION_CAMPAIGN,
            &passerby_id,
            "investigation-long-talk-1",
            player_input,
            "我每天只走固定邮路；今天先看见蓝雨衣，后来才听到观测站方向的车声。",
            "愿意交谈",
            json!({"trust":1}),
        );
        snapshot.messages.len()
    };
    let second_count = {
        let store = CampaignStore::open(database_path).expect("reopen passerby second turn");
        let snapshot = commit_dialogue(
            &store,
            INVESTIGATION_CAMPAIGN,
            &passerby_id,
            "investigation-long-talk-2",
            &format!("{player_input} 第二天继续核对邮路顺序。"),
            "第二天的邮袋封签完整；蓝雨衣没有出现，但六码头多了一辆未登记货车。",
            "熟悉",
            json!({"closeness":1}),
        );
        snapshot.messages.len()
    };
    let final_snapshot = {
        let store = CampaignStore::open(database_path).expect("reopen passerby third turn");
        commit_dialogue(
            &store,
            INVESTIGATION_CAMPAIGN,
            &passerby_id,
            "investigation-long-talk-3",
            &format!("{player_input} 第三天询问他愿意公开哪些亲历。"),
            "我只愿公开自己递送和目击的部分；车牌来自转述，不能写成我的证词。",
            "谨慎信任",
            json!({"obligation":1}),
        )
    };
    assert_eq!(second_count, first_count + 2);
    assert_eq!(final_snapshot.messages.len(), second_count + 2);
    assert_eq!(final_snapshot.relationship.trust, 1);
    assert_eq!(final_snapshot.relationship.closeness, 1);
    assert_eq!(final_snapshot.relationship.obligation, 1);
}

fn attempt_quest_item_sale(database_path: &Path, player_input: &str) {
    let store = CampaignStore::open(database_path).expect("open cyberpunk item sale save");
    let owner_id = owner_id(&store, CYBERPUNK_CAMPAIGN);
    let money_before = money(&store, CYBERPUNK_CAMPAIGN);
    let rewards_before = reward_item_count(&store, CYBERPUNK_CAMPAIGN);
    commit_dialogue(
        &store,
        CYBERPUNK_CAMPAIGN,
        &owner_id,
        "cyberpunk-sell-quest-item",
        player_input,
        "净化访问片绑定着未结支线的来源链，当前不能当普通货物出售；我可以登记保管，但不会凭空增加信用点。",
        "明确",
        json!({}),
    );
    assert_eq!(money(&store, CYBERPUNK_CAMPAIGN), money_before);
    assert_eq!(
        reward_item_count(&store, CYBERPUNK_CAMPAIGN),
        rewards_before
    );
}

fn defect_to_enemy(database_path: &Path, player_input: &str) {
    let store = CampaignStore::open(database_path).expect("reopen cyberpunk faction save");
    let owner_id = owner_id(&store, CYBERPUNK_CAMPAIGN);
    commit_dialogue(
        &store,
        CYBERPUNK_CAMPAIGN,
        &owner_id,
        "cyberpunk-defect",
        player_input,
        "你可以选择栖桥公司，但互助网会把这次站队写入公开账本；旧关系不会被系统替你抹掉。",
        "失望",
        json!({"trust":-1}),
    );
    let before = store
        .active_faction_snapshot(CYBERPUNK_CAMPAIGN)
        .expect("load cyberpunk factions before defection");
    let corporation = before
        .factions
        .iter()
        .find(|faction| faction.name == "栖桥公司")
        .expect("active corporate faction")
        .clone();
    let location_id = store
        .dynamic_location_snapshot(CYBERPUNK_CAMPAIGN)
        .expect("load cyberpunk location")
        .state
        .current_location_id;
    let after = store
        .apply_faction_action(FactionActionCommand {
            event_id: "m11-free-input-defect-event".to_owned(),
            operation_id: "m11-free-input-defect-operation".to_owned(),
            campaign_id: CYBERPUNK_CAMPAIGN.to_owned(),
            expected_revision: corporation.revision,
            proposal: FactionActionProposal {
                id: "m11-free-input-defect-proposal".to_owned(),
                faction_id: corporation.id.clone(),
                kind: "MOBILIZE".to_owned(),
                source: "PLAYER".to_owned(),
                summary: "玩家公开投靠栖桥公司并接受社区关系后果。".to_owned(),
                required_resources: Vec::new(),
                target_faction_id: None,
                target_location_id: None,
                target_quest_id: None,
                consequences: vec![
                    FactionActionConsequence::PlayerRelationSet {
                        relation: "ALLIED".to_owned(),
                    },
                    FactionActionConsequence::WorldFact {
                        statement: "网格快递员公开投靠栖桥公司，七码头互助网保留了这次站队记录。"
                            .to_owned(),
                        location_id: Some(location_id),
                    },
                ],
            },
            budget: FactionActionBudget {
                decision_id: "m11-free-input-defect-budget".to_owned(),
                action_points: 3,
                quest_changes: 0,
                world_facts: 1,
            },
            world_fact_id: Some("m11-free-input-defection-fact".to_owned()),
        })
        .expect("persist player defection and consequences");
    let saved = after
        .factions
        .iter()
        .find(|faction| faction.id == corporation.id)
        .expect("reloaded corporate faction");
    assert_eq!(saved.player_relation, "ALLIED");
    assert_eq!(after.action_history.len(), before.action_history.len() + 1);
}

fn verify_and_export(database_path: &Path, campaign_id: &str) {
    let store = CampaignStore::open(database_path).expect("reopen stressed campaign");
    let connection = store.connect().expect("inspect stressed campaign");
    let state: String = connection
        .query_row(
            "SELECT state FROM campaigns WHERE id=?1",
            [campaign_id],
            |row| row.get(0),
        )
        .expect("stress campaign state");
    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .expect("stress integrity check");
    let unfinished: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM pending_ai_requests WHERE campaign_id=?1 AND status NOT IN ('COMMITTED','CANCELLED')",
            [campaign_id],
            |row| row.get(0),
        )
        .expect("unfinished stress requests");
    assert_eq!(state, "TAVERN");
    assert_eq!(integrity, "ok");
    assert_eq!(unfinished, 0);
    drop(connection);
    let archive_path = database_path
        .parent()
        .expect("stress database parent")
        .join("campaign.emtavern");
    store
        .export_campaign_archive(campaign_id, archive_path, "0.3.0-m11-free-input")
        .expect("export stressed campaign");
}

#[allow(clippy::too_many_arguments)]
fn commit_dialogue(
    store: &CampaignStore,
    campaign_id: &str,
    npc_id: &str,
    suffix: &str,
    player_message: &str,
    reply: &str,
    mood: &str,
    relationship_proposal: Value,
) -> crate::NpcDialogueSnapshot {
    let snapshot = store
        .npc_dialogue_snapshot(campaign_id, npc_id)
        .expect("load stress dialogue context");
    let mut input = snapshot.generation_context.clone();
    input
        .as_object_mut()
        .expect("stress dialogue context object")
        .insert("playerMessage".to_owned(), json!(player_message));
    let output = json!({
        "reply":reply,
        "mood":mood,
        "suggestedTopics":[format!("{suffix}-后果")],
        "memoryCandidate":null,
        "relationshipProposal":relationship_proposal,
    });
    store
        .commit_npc_dialogue(NpcDialogueCommit {
            campaign_id: campaign_id.to_owned(),
            npc_id: npc_id.to_owned(),
            player_message: player_message.to_owned(),
            generation: TavernGenerationAudit {
                request_id: format!("m11-free-input-request-{suffix}"),
                generation_record_id: format!("m11-free-input-generation-{suffix}"),
                idempotency_key: format!("m11-free-input:{suffix}"),
                prompt_version: 3,
                input,
                context: json!({"npcId":npc_id}),
                request: json!({"task":"NPC_REPLY","modelName":"ember-fake-v1"}),
                raw_response_text: output.to_string(),
                validated_output: output,
            },
            timeline_submission_id: None,
            timeline_attempt_id: None,
        })
        .expect("commit stress free-input dialogue")
}

fn accepted_quest(store: &CampaignStore, campaign_id: &str) -> (String, i64) {
    store
        .connect()
        .expect("query accepted quest")
        .query_row(
            "SELECT quest_id,revision FROM quest_pool_states WHERE campaign_id=?1 AND status='ACCEPTED' ORDER BY quest_id LIMIT 1",
            [campaign_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("accepted stress quest")
}

fn owner_id(store: &CampaignStore, campaign_id: &str) -> String {
    store
        .connect()
        .expect("query tavern owner")
        .query_row(
            "SELECT owner_npc_id FROM taverns WHERE campaign_id=?1",
            [campaign_id],
            |row| row.get(0),
        )
        .expect("stress tavern owner")
}

fn npc_id_by_name(store: &CampaignStore, campaign_id: &str, name: &str) -> String {
    store
        .connect()
        .expect("query stress NPC")
        .query_row(
            "SELECT id FROM npcs WHERE campaign_id=?1 AND name=?2",
            params![campaign_id, name],
            |row| row.get(0),
        )
        .expect("named stress NPC")
}

fn relationship_trust(store: &CampaignStore, npc_id: &str) -> i64 {
    store
        .connect()
        .expect("query stress relationship")
        .query_row(
            "SELECT trust FROM npc_relationships WHERE npc_id=?1",
            [npc_id],
            |row| row.get(0),
        )
        .expect("stress relationship trust")
}

fn money(store: &CampaignStore, campaign_id: &str) -> i64 {
    store
        .connect()
        .expect("query stress money")
        .query_row(
            "SELECT money FROM character_rule_states WHERE campaign_id=?1",
            [campaign_id],
            |row| row.get(0),
        )
        .expect("stress money")
}

fn reward_item_count(store: &CampaignStore, campaign_id: &str) -> i64 {
    store
        .connect()
        .expect("query stress reward items")
        .query_row(
            "SELECT COUNT(*) FROM items WHERE campaign_id=?1 AND source_adventure_id IS NOT NULL",
            [campaign_id],
            |row| row.get(0),
        )
        .expect("stress reward item count")
}

fn action_input<'a>(script: &'a [StressAction], id: &str) -> &'a str {
    script
        .iter()
        .find(|action| action.id == id)
        .map(|action| action.input.as_str())
        .unwrap_or_else(|| panic!("missing stress action {id}"))
}

fn required_path(name: &str) -> std::path::PathBuf {
    std::env::var_os(name)
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| panic!("{name} is required"))
}
