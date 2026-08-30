use serde_json::{Value, json};

use super::*;

const CAMPAIGN_ID: &str = "playtest-m11-investigation";
const AT: &str = "2026-08-27T02:00:00.000Z";

#[test]
fn completes_the_investigation_vertical_slice_on_one_persistent_save() {
    let directory = tempfile::tempdir().expect("temporary investigation directory");
    let database_path = std::env::var_os("EMBER_INVESTIGATION_PLAYTEST_DATABASE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| directory.path().join("investigation.sqlite"));
    let archive_path = std::env::var_os("EMBER_INVESTIGATION_PLAYTEST_ARCHIVE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| directory.path().join("investigation.emtavern"));
    if let Some(parent) = database_path.parent() {
        std::fs::create_dir_all(parent).expect("create investigation database directory");
    }
    if let Some(parent) = archive_path.parent() {
        std::fs::create_dir_all(parent).expect("create investigation archive directory");
    }

    let store = CampaignStore::open(&database_path).expect("open investigation database");
    store
        .create_at(CAMPAIGN_ID.to_owned(), AT.to_owned())
        .expect("create investigation campaign");
    let world = investigation_world();
    let world_output = serde_json::to_value(&world).expect("serialize investigation world");
    store
        .commit_world_generation(WorldGenerationCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            task: WorldGenerationTask::GenerateWorld,
            request_id: "investigation-world-request".to_owned(),
            generation_record_id: "investigation-world-generation".to_owned(),
            idempotency_key: "investigation:world".to_owned(),
            prompt_version: 1,
            input: json!({"theme":"雾港失踪电台"}),
            request: json!({"task":"GENERATE_WORLD","modelName":"ember-fake-v1"}),
            raw_response_text: world_output.to_string(),
            validated_output: world_output,
            world: world.clone(),
        })
        .expect("generate investigation world");
    store
        .update_world_draft(WorldManualUpdate {
            campaign_id: CAMPAIGN_ID.to_owned(),
            world,
            locked_fields: vec!["name".to_owned(), "powerRules".to_owned()],
        })
        .expect("lock investigation world fields");
    store
        .confirm_world(CAMPAIGN_ID)
        .expect("confirm investigation world");
    install_investigation_extension(&store);

    let careers = store
        .commit_career_pool_generation(investigation_career_pool(&store))
        .expect("generate investigation career pool");
    assert_eq!(careers.careers.len(), 3);

    let character = investigation_character();
    let trait_output = json!({
        "traits": [
            {"name":"冷读习惯","description":"善于捕捉谈话细节，却容易把巧合误当成模式。"},
            {"name":"静电梦魇","description":"反复梦见相同呼号，但无法确认它是真实记忆。"},
            {"name":"档案耐心","description":"愿意逐页核对记录。"},
            {"name":"雨夜方向感","description":"熟悉雾港街道。"},
            {"name":"谨慎采访","description":"不会先暴露线人。"},
            {"name":"设备常识","description":"认识常用无线电器件。"}
        ]
    });
    let traits = store
        .commit_character_traits(CharacterTraitGenerationCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            character: character.clone(),
            generation: character_audit(
                "traits",
                "GENERATE_CHARACTER_TRAITS",
                json!({
                    "concept": character.concept,
                    "classArchetype": character.class_archetype,
                    "personalGoal": character.personal_goal,
                    "storyPreferences": character.story_preferences,
                }),
                json!({"character":character}),
                trait_output,
            ),
        })
        .expect("generate investigation traits");
    let selected_traits = traits.trait_candidates[..2].to_vec();
    let trait_generation_record_id = traits
        .trait_generation_record_id
        .expect("investigation trait generation record");
    let background_output = json!({
        "birthplace":"雾港北堤",
        "formativeExperience":"在一次档案火灾中抢救出无线电牌照册。",
        "adventureMotivation":"查清失踪电台与港务记录被改写的关系。",
        "secret":"曾误把一个错误日期写入公开索引。",
        "importantPerson":"失联的前任档案主管。",
        "tavernArrivalReason":"追踪凌晨两点出现的空白频段。",
        "initialEquipment":[
            {"name":"折叠式板盒相机","description":"需要稳定支撑和显影时间的证据相机。"},
            {"name":"封线证物簿","description":"逐页编号并记录每次交接。"}
        ]
    });
    let proposed = store
        .commit_character_completion(CharacterCompletionCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            character: character.clone(),
            trait_generation_record_id: trait_generation_record_id.clone(),
            selected_traits: selected_traits.clone(),
            generation: character_audit(
                "background",
                "COMPLETE_CHARACTER_BACKGROUND",
                json!({
                    "name":character.name,
                    "concept":character.concept,
                    "classDisplayName":character.class_display_name,
                    "personalGoal":character.personal_goal,
                    "traits":selected_traits.iter().map(|value| json!({
                        "name":value.name,"description":value.description
                    })).collect::<Vec<_>>(),
                }),
                json!({
                    "character":character,
                    "selectedTraits":selected_traits,
                    "traitGenerationRecordId":trait_generation_record_id,
                }),
                background_output,
            ),
        })
        .expect("propose investigation character");
    let completed_character = store
        .confirm_character_candidate(CharacterCandidateConfirm {
            campaign_id: CAMPAIGN_ID.to_owned(),
            candidate_id: proposed.candidate.expect("investigation candidate").id,
        })
        .expect("confirm investigation character");
    let player_character_id = completed_character
        .character
        .as_ref()
        .expect("confirmed investigation character")
        .draft
        .id
        .clone();
    persist_investigation_extension_values(&store, &player_character_id);

    let source = store
        .tavern_snapshot(CAMPAIGN_ID)
        .expect("investigation tavern source")
        .source;
    let tavern_output = json!({
        "name":"潮痕咖啡馆",
        "position":"雾港旧报社与电车终点之间",
        "environment":"雨水沿磨砂窗流下，电话交换线从后墙穿入地下室。",
        "specialRules":["未经核实的消息不得写上公共黑板。"],
        "longTermProblem":"凌晨两点的空白频段连续三夜覆盖港务广播。",
        "owner":npc_output(
            "伊芙琳",
            "潮痕咖啡馆夜班经理",
            "敏锐而防备媒体",
            "找回失踪的弟弟",
            "她删去了一次私人电话记录"
        ),
    });
    let tavern = store
        .commit_tavern_generation(TavernGenerationCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            generation: audit(
                "tavern",
                "GENERATE_TAVERN",
                json!({
                    "world":source.world,
                    "playerConcept":source.player_concept,
                    "desiredPosition":source.desired_position,
                }),
                json!({"source":source}),
                tavern_output,
            ),
        })
        .expect("generate investigation tavern");
    let tavern_id = tavern.tavern.expect("investigation tavern").id;
    let snapshot = store.tavern_snapshot(CAMPAIGN_ID).expect("tavern snapshot");
    let source = snapshot.source;
    let tavern = snapshot.tavern.expect("stored investigation tavern");
    let owner = snapshot.npcs.first().expect("investigation owner");
    let roster_output = json!({
        "npcs":[
            roster_npc("RESIDENT","罗兹","海雾观测站值夜员","拘谨、依赖程序","保住即将裁撤的岗位","他把异常噪声归档到错误日期",Value::Null),
            roster_npc("RESIDENT","敏恩","地方晚报记者","急切但重视可核实来源","抢在竞争报社前发表调查","她收到过匿名资助",Value::Null),
            roster_npc("TEMPORARY_VISITOR","早班邮差","雾港邮路投递员","疲惫而直接","在天亮前投完积压信件","看见过携带发报箱的陌生人",json!("等待第一班电车。"))
        ],
        "rumors":[
            {"statement":"地下室藏着第二台发报机。","sourceNpcName":"早班邮差","sourceBasis":"HEARSAY","confidence":0.35,"veracity":"FALSE"},
            {"statement":"异常噪声只在退潮前出现。","sourceNpcName":"罗兹","sourceBasis":"WITNESS","confidence":0.75,"veracity":"PARTIAL"},
            {"statement":"报社愿为失踪电台照片付费。","sourceNpcName":"敏恩","sourceBasis":"FACTION_MESSAGE","confidence":0.8,"veracity":"TRUE"}
        ]
    });
    let completed_tavern = store
        .commit_npc_roster_generation(NpcRosterGenerationCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            tavern_id: tavern_id.clone(),
            generation: audit(
                "roster",
                "GENERATE_NPCS",
                json!({
                    "world":source.world,
                    "tavern":{
                        "name":tavern.name,
                        "position":tavern.position,
                        "environment":tavern.environment,
                        "longTermProblem":tavern.long_term_problem,
                    },
                    "existingNpcNames":[owner.name],
                    "existingNpcArchetypes":[crate::repetition::npc_archetype_signature(&owner.identity,&owner.personality)],
                    "requestedCount":3,
                }),
                json!({"source":source,"tavernId":tavern_id}),
                roster_output,
            ),
        })
        .expect("generate investigation roster");
    assert_eq!(completed_tavern.campaign_state, "TAVERN");
    assert_eq!(completed_tavern.npcs.len(), 4);
    let owner_id = completed_tavern
        .tavern
        .expect("complete investigation tavern")
        .owner_npc_id;

    run_investigation_play(
        &store,
        &database_path,
        &archive_path,
        &player_character_id,
        &owner_id,
    );
}

fn run_investigation_play(
    store: &CampaignStore,
    database_path: &std::path::Path,
    archive_path: &std::path::Path,
    player_character_id: &str,
    owner_id: &str,
) {
    let roster = store
        .tavern_snapshot(CAMPAIGN_ID)
        .expect("investigation roster");
    let scene_npc_ids = roster
        .npcs
        .iter()
        .take(2)
        .map(|npc| npc.id.clone())
        .collect::<Vec<_>>();
    let population = store
        .project_tavern_population(TavernPopulationProjectCommand {
            campaign_id: CAMPAIGN_ID.to_owned(),
            trigger: "ENTERED".to_owned(),
            operation_id: "investigation-population-project".to_owned(),
            cycle_id: "investigation-population-cycle".to_owned(),
        })
        .expect("project investigation population");
    assert_eq!(population.state.expect("population state").revision, 1);
    for (index, npc_id) in scene_npc_ids.iter().enumerate() {
        store
            .focus_tavern_population(TavernPopulationFocusCommand {
                campaign_id: CAMPAIGN_ID.to_owned(),
                npc_id: npc_id.clone(),
                expected_revision: index as i64 + 1,
                operation_id: format!("investigation-focus-op-{index}"),
                event_id: format!("investigation-focus-event-{index}"),
            })
            .expect("focus investigation scene participant");
    }
    store
        .start_tavern_scene(TavernSceneStart {
            campaign_id: CAMPAIGN_ID.to_owned(),
            scene_id: "investigation-cafe-scene".to_owned(),
            operation_id: "investigation-cafe-scene-start".to_owned(),
            participant_npc_ids: scene_npc_ids,
            listening_npc_ids: Vec::new(),
        })
        .expect("start investigation scene");
    let scene_intent = "Ask which witness personally heard the two o'clock call sign.";
    let prepared_scene = store
        .prepare_tavern_scene_turn(TavernScenePrepare {
            campaign_id: CAMPAIGN_ID.to_owned(),
            scene_id: "investigation-cafe-scene".to_owned(),
            player_intent: scene_intent.to_owned(),
            addressed_npc_id: Some(owner_id.to_owned()),
        })
        .expect("prepare investigation scene");
    let generations = prepared_scene
        .actor_inputs
        .iter()
        .enumerate()
        .map(|(index, actor)| {
            let speaks = actor.actor_id == owner_id;
            let output = json!({
                "actorId":actor.actor_id,
                "action":if speaks { "SPEAK" } else { "SILENCE" },
                "targetNpcId":null,
                "utterance":if speaks { Some("I heard it myself, but I cannot identify the transmitter.") } else { None },
                "citedKnowledgeIds":[],
                "urgency":if speaks { 2 } else { 0 },
                "rationale":if speaks { "Separate direct hearing from the unknown source." } else { "The addressed witness answers first." },
            });
            TavernSceneActorGeneration {
                actor_id: actor.actor_id.clone(),
                generation: character_audit(
                    &format!("scene-{index}"),
                    "PROPOSE_TAVERN_SCENE_ACTION",
                    actor.input.clone(),
                    json!({"actorId":actor.actor_id,"sceneId":"investigation-cafe-scene"}),
                    output,
                ),
            }
        })
        .collect();
    let scene = store
        .commit_tavern_scene_turn(TavernSceneCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            scene_id: "investigation-cafe-scene".to_owned(),
            expected_revision: 1,
            turn_id: "investigation-cafe-scene-turn-1".to_owned(),
            operation_id: "investigation-cafe-scene-turn-op-1".to_owned(),
            player_intent: scene_intent.to_owned(),
            addressed_npc_id: Some(owner_id.to_owned()),
            generations,
            timeline_submission_id: None,
            timeline_attempt_id: None,
        })
        .expect("commit investigation scene");
    assert_eq!(scene.turns.len(), 1);

    let initial_dialogue = store
        .npc_dialogue_snapshot(CAMPAIGN_ID, owner_id)
        .expect("initial investigation dialogue");
    let dialogue = store
        .commit_npc_dialogue(investigation_dialogue(
            &initial_dialogue,
            owner_id,
            1,
            "Was the call sign transmitted from your basement?",
        ))
        .expect("commit bounded investigation dialogue");
    assert_eq!(dialogue.messages.len(), 2);

    let item_ids = {
        let connection = store.connect().expect("query investigation equipment");
        let mut statement = connection
            .prepare(
                "SELECT id FROM items WHERE campaign_id=?1 AND owner_character_id=?2 ORDER BY id",
            )
            .expect("prepare investigation equipment query");
        statement
            .query_map(params![CAMPAIGN_ID, player_character_id], |row| {
                row.get::<_, String>(0)
            })
            .expect("query investigation equipment")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect investigation equipment")
    };
    assert_eq!(item_ids.len(), 2);
    apply_rule(
        store,
        player_character_id,
        1,
        "equip-plate-camera",
        RulesAuthority::PlayerAction,
        RulesAction::EquipItem {
            item_id: item_ids[0].clone(),
        },
    );
    apply_rule(
        store,
        player_character_id,
        2,
        "archive-copy-payment",
        RulesAuthority::LocalRule,
        RulesAction::ChangeMoney { delta: 12 },
    );
    apply_rule(
        store,
        player_character_id,
        3,
        "tram-to-observatory",
        RulesAuthority::LocalRule,
        RulesAction::AdvanceTime { minutes: 60 },
    );
    apply_rule(
        store,
        player_character_id,
        4,
        "unequip-plate-camera",
        RulesAuthority::PlayerAction,
        RulesAction::UnequipItem {
            item_id: item_ids[0].clone(),
        },
    );
    apply_rule(
        store,
        player_character_id,
        5,
        "equip-evidence-book",
        RulesAuthority::PlayerAction,
        RulesAction::EquipItem {
            item_id: item_ids[1].clone(),
        },
    );
    apply_rule(
        store,
        player_character_id,
        6,
        "buy-developer",
        RulesAuthority::LocalRule,
        RulesAction::ChangeMoney { delta: -3 },
    );
    apply_rule(
        store,
        player_character_id,
        7,
        "wait-for-broadcast",
        RulesAuthority::LocalRule,
        RulesAction::AdvanceTime { minutes: 600 },
    );
    apply_rule(
        store,
        player_character_id,
        8,
        "rain-chill-before-sealed-room",
        RulesAuthority::LocalRule,
        RulesAction::AddStatus {
            status: RuleStatus {
                id: "investigation-rain-chill".to_owned(),
                kind: RuleStatusKind::Debuff,
                label: "雨寒".to_owned(),
                attribute_modifiers: std::collections::BTreeMap::from([(
                    "physique".to_owned(),
                    -5,
                )]),
                expires_at_game_minute: Some(720),
            },
        },
    );
    let rule_state = store
        .character_rules_state(player_character_id)
        .expect("investigation rules state");
    assert_eq!(rule_state.money, 9);
    assert_eq!(rule_state.game_time_minutes, 660);
    assert_eq!(rule_state.equipped_item_ids, vec![item_ids[1].clone()]);
    assert_extension_values(store, 62, 48, 35, 0);

    let locations = store
        .dynamic_location_snapshot(CAMPAIGN_ID)
        .expect("investigation location graph");
    let origin_location_id = locations.state.current_location_id.clone();
    let generation = store
        .dynamic_location_generation_snapshot(DynamicLocationGenerationRequest {
            campaign_id: CAMPAIGN_ID.to_owned(),
            origin_location_id: origin_location_id.clone(),
            expansion_mode: "CONNECTED".to_owned(),
            requested_count: 1,
        })
        .expect("prepare observatory location");
    let location_output = json!({
        "schemaVersion":1,
        "locations":[{
            "id":"investigation-fog-observatory",
            "name":"海雾观测站",
            "kind":"SPECIAL",
            "parentLocationId":null,
            "description":"停用的海岸观测站仍保留电话线与噪声日志。",
            "atmosphere":"盐雾压低视线，雨点敲击封死的百叶窗。",
            "features":["贴有新封条的记录室","停转的风向仪"],
            "factionIds":[],
            "connections":[origin_location_id],
            "currentSituation":"值夜员正在整理一份日期错位的日志。",
            "constitutionEvidence":generation.input["constitutionEvidence"],
        }]
    });
    store
        .commit_dynamic_location_generation(DynamicLocationGenerationCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            origin_location_id: origin_location_id.clone(),
            expansion_mode: "CONNECTED".to_owned(),
            requested_count: 1,
            generation: character_audit(
                "observatory",
                "GENERATE_LOCATIONS",
                generation.input,
                json!({
                    "campaignId":CAMPAIGN_ID,
                    "originLocationId":origin_location_id,
                    "expansionMode":"CONNECTED",
                    "requestedCount":1,
                }),
                location_output,
            ),
        })
        .expect("commit observatory location");
    store
        .travel_dynamic_location(DynamicLocationTravelCommand {
            campaign_id: CAMPAIGN_ID.to_owned(),
            target_location_id: "investigation-fog-observatory".to_owned(),
            expected_revision: 1,
            mode: "ROAD".to_owned(),
            event_id: "investigation-travel-observatory".to_owned(),
            operation_id: "investigation-travel-observatory-op".to_owned(),
        })
        .expect("travel to observatory");

    let first_quest_id = generate_investigation_quest(
        store,
        owner_id,
        "blank-frequency",
        "凌晨两点的空白频段",
        "确定异常呼号的设备、时间与传播路径。",
        "关键设备会在牌照审查前被转移。",
        "MODERATE",
    );
    store
        .accept_quest(CAMPAIGN_ID, &first_quest_id)
        .expect("accept blank frequency quest");
    let second_quest_id = generate_investigation_quest(
        store,
        owner_id,
        "blacked-tide-table",
        "被涂黑的潮位表",
        "恢复被覆盖的潮位记录并验证改写动机。",
        "一名证人将因错误时间线被指控。",
        "HIGH",
    );
    store
        .accept_quest(CAMPAIGN_ID, &second_quest_id)
        .expect("accept tide table quest");

    let preparation = store
        .adventure_snapshot(CAMPAIGN_ID, Some(&first_quest_id))
        .expect("prepare investigation adventure");
    let planned = store
        .commit_adventure_plan(AdventurePlanCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            quest_id: first_quest_id.clone(),
            generation: audit(
                "plan",
                "GENERATE_ADVENTURE_PLAN",
                preparation.plan_input,
                json!({"questId":first_quest_id,"playerCharacterId":player_character_id}),
                investigation_plan_output(),
            ),
        })
        .expect("plan investigation adventure");
    let adventure_id = planned.adventure_id.expect("investigation adventure id");
    store
        .start_adventure(CAMPAIGN_ID, &adventure_id)
        .expect("start investigation adventure");
    let mut ending = None;
    let mut first_check_failed = false;
    for turn_number in 1..=8 {
        let pending = store
            .submit_adventure_action(AdventureActionSubmit {
                campaign_id: CAMPAIGN_ID.to_owned(),
                adventure_id: adventure_id.clone(),
                action_mode: "ACTION".to_owned(),
                player_action: if turn_number == 1 {
                    "Compare the altered log date without breaking the evidence seal.".to_owned()
                } else {
                    format!("Follow investigation lead {turn_number}")
                },
            })
            .expect("submit investigation action after any prior failure");
        let turn_id = pending
            .turns
            .last()
            .and_then(|turn| turn.get("id"))
            .and_then(Value::as_str)
            .expect("investigation turn id")
            .to_owned();
        let is_ending = turn_number == 8;
        let committed = store
            .commit_adventure_turn(AdventureTurnCommit {
                campaign_id: CAMPAIGN_ID.to_owned(),
                adventure_id: adventure_id.clone(),
                generation: audit(
                    &format!("turn-{turn_number}"),
                    "GENERATE_ADVENTURE_TURN",
                    pending
                        .turn_generation_context
                        .expect("investigation turn context"),
                    json!({"adventureId":adventure_id,"turnId":turn_id}),
                    investigation_turn_output(is_ending, turn_number == 1),
                ),
            })
            .expect("commit investigation turn");
        if is_ending {
            ending = Some(committed);
        } else {
            let rolled = store
                .roll_adventure_check(CAMPAIGN_ID, &adventure_id)
                .expect("roll investigation D20");
            if turn_number == 1 {
                first_check_failed = !rolled
                    .turns
                    .last()
                    .and_then(|turn| turn.get("diceResult"))
                    .and_then(|dice| dice.get("success"))
                    .and_then(Value::as_bool)
                    .expect("first investigation hard result");
            }
            store
                .commit_adventure_dice(AdventureDiceCommit {
                    campaign_id: CAMPAIGN_ID.to_owned(),
                    adventure_id: adventure_id.clone(),
                    generation: audit(
                        &format!("dice-{turn_number}"),
                        "RESOLVE_DICE_RESULT",
                        rolled
                            .dice_generation_input
                            .expect("investigation dice input"),
                        json!({"adventureId":adventure_id,"turnId":turn_id}),
                        if turn_number == 1 {
                            json!({
                                "narration":"封条没有破损，但错位页码仍无法证明是谁改写日期。",
                                "consequence":"失败保留不确定性，同时显露下一页的交换台编号。",
                                "statePatchProposals":[],
                            })
                        } else {
                            json!({
                                "narration":"新的比对结果把线索推进到下一处记录。",
                                "consequence":"调查继续，但每项结论仍保留来源。",
                                "statePatchProposals":[],
                            })
                        },
                    ),
                })
                .expect("commit investigation D20 consequence");
        }
    }
    assert!(
        first_check_failed,
        "difficulty 17 plus the active rain-chill modifier must produce the failed lead"
    );
    assert_eq!(ending.expect("investigation ending").current_turn_number, 8);

    store
        .travel_dynamic_location(DynamicLocationTravelCommand {
            campaign_id: CAMPAIGN_ID.to_owned(),
            target_location_id: origin_location_id,
            expected_revision: 2,
            mode: "ROAD".to_owned(),
            event_id: "investigation-travel-return".to_owned(),
            operation_id: "investigation-travel-return-op".to_owned(),
        })
        .expect("return to cafe");
    let clock_id = store
        .tavern_snapshot(CAMPAIGN_ID)
        .expect("investigation settlement clock")
        .clocks[0]
        .id
        .clone();
    store
        .commit_adventure_settlement(investigation_settlement(
            &adventure_id,
            &first_quest_id,
            owner_id,
            &clock_id,
        ))
        .expect("settle investigation adventure");
    let quest_connection = store.connect().expect("query investigation quest states");
    let quest_status = |quest_id: &str| {
        quest_connection
            .query_row(
                "SELECT status FROM quest_pool_states WHERE campaign_id=?1 AND quest_id=?2",
                params![CAMPAIGN_ID, quest_id],
                |row| row.get::<_, String>(0),
            )
            .expect("investigation quest status")
    };
    assert_eq!(quest_status(&first_quest_id), "COMPLETED");
    assert_eq!(quest_status(&second_quest_id), "ACCEPTED");
    drop(quest_connection);

    let director = store
        .prepare_world_director(WorldDirectorPrepareCommand {
            campaign_id: CAMPAIGN_ID.to_owned(),
        })
        .expect("prepare investigation director");
    store
        .commit_world_director(WorldDirectorCommitCommand {
            id: "investigation-director-after-dawn".to_owned(),
            campaign_id: CAMPAIGN_ID.to_owned(),
            trigger: WorldDirectorTrigger {
                kind: "MANUAL".to_owned(),
                id: "investigation-director-manual".to_owned(),
            },
            expected_context_digest: director.context_digest,
            occurred_at: "2026-08-27T03:00:00.000Z".to_owned(),
        })
        .expect("commit investigation director");

    let second_dialogue_snapshot = store
        .npc_dialogue_snapshot(CAMPAIGN_ID, owner_id)
        .expect("continued investigation dialogue");
    let second_dialogue = store
        .commit_npc_dialogue(investigation_dialogue(
            &second_dialogue_snapshot,
            owner_id,
            2,
            "Did Rhodes know your family connection?",
        ))
        .expect("commit limited-knowledge follow-up");
    assert_eq!(second_dialogue.messages.len(), 4);
    drop(second_dialogue);

    let reopened = CampaignStore::open(database_path).expect("reopen investigation save");
    assert_eq!(
        reopened
            .continue_campaign(CAMPAIGN_ID)
            .expect("continue save")
            .state,
        "TAVERN"
    );
    assert_extension_values(&reopened, 62, 48, 35, 0);
    reopened
        .connect()
        .expect("seed investigation interrupted request")
        .execute(
            "INSERT INTO pending_ai_requests (
               id,campaign_id,turn_id,idempotency_key,task,status,model_profile_id,
               input_json,context_json,attempt_count,last_error_json,created_at,updated_at
             ) VALUES (?1,?2,NULL,?3,'NPC_REPLY','SENDING',NULL,'{}','{}',1,NULL,?4,?4)",
            params![
                "investigation-interrupted-request",
                CAMPAIGN_ID,
                "investigation:interrupted-request",
                "2026-08-27T03:10:00.000Z"
            ],
        )
        .expect("persist investigation interrupted request");
    reopened
        .connect()
        .expect("mark investigation recovery")
        .execute(
            "UPDATE campaigns SET state='RECOVERY_REQUIRED',resume_state='TAVERN' WHERE id=?1",
            [CAMPAIGN_ID],
        )
        .expect("mark recovery required");
    drop(reopened);

    let recovered = CampaignStore::open(database_path).expect("reopen failed investigation save");
    assert_eq!(
        recovered
            .campaign_recovery(CAMPAIGN_ID)
            .expect("inspect investigation recovery")
            .unfinished_request_count,
        1
    );
    recovered
        .restore_campaign_after_failure(CAMPAIGN_ID)
        .expect("restore investigation campaign");
    recovered
        .export_campaign_archive(CAMPAIGN_ID, archive_path, "0.1.0")
        .expect("export investigation archive");
    recovered
        .import_campaign_archive(archive_path, CampaignArchiveImportMode::Overwrite)
        .expect("overwrite investigation archive");
    drop(recovered);

    let imported = CampaignStore::open(database_path).expect("reopen imported investigation save");
    assert_eq!(
        imported
            .continue_campaign(CAMPAIGN_ID)
            .expect("continue import")
            .state,
        "TAVERN"
    );
    assert_extension_values(&imported, 62, 48, 35, 0);
    assert_eq!(
        imported
            .npc_dialogue_snapshot(CAMPAIGN_ID, owner_id)
            .expect("imported investigation dialogue")
            .messages
            .len(),
        4
    );
    assert_eq!(
        imported
            .list_adventure_archives(CAMPAIGN_ID)
            .expect("investigation archives")
            .len(),
        1
    );
}

fn investigation_world() -> WorldDraft {
    WorldDraft {
        constitution: WorldConstitutionDraft {
            schema_version: 1,
            world_type: "近代都市调查与心理悬疑".to_owned(),
            era: "架空的一九二〇年代海港工业城".to_owned(),
            technology: "有线电话、真空管电台、胶片摄影与燃油交通".to_owned(),
            magic: "异常现象稀少、暧昧且不能替代证据链".to_owned(),
            peoples: vec![
                "港城居民".to_owned(),
                "外来船员".to_owned(),
                "山地移民".to_owned(),
            ],
            society: "警署、报社、工会和私人社团交错影响公共叙事".to_owned(),
            politics: "港务财团与市议会围绕无线电牌照相互施压".to_owned(),
            economy: "现金、工资与社会信用共同限制调查资源".to_owned(),
            combat_scale: "危险短促且代价高，调查和撤退通常优先".to_owned(),
            death_rules: "死亡永久；精神与身体后果分开记录".to_owned(),
            career_rules: "职业由教育、执照、雇佣机构和社会网络决定".to_owned(),
            equipment_rules: "时代工具脆弱且用途具体，证据物不得变成通用加成".to_owned(),
            npc_rules: "证词可能错误、隐瞒或受误导，但知识来源必须可追踪".to_owned(),
            trait_rules: "调查优势必须伴随压力、偏见或社会代价".to_owned(),
            taboos: vec![
                "照搬受版权保护规则文本".to_owned(),
                "一次失败永久锁死核心线索".to_owned(),
                "现代数字设备".to_owned(),
            ],
        },
        name: "雾港失踪电台".to_owned(),
        current_region: "雾港".to_owned(),
        summary: "无线电牌照、雨夜证词与错位记录纠缠的近代港城。".to_owned(),
        core_conflict: "港务财团与报社争夺失踪电台事件的解释权。".to_owned(),
        technology_level: "有线电话、真空管电台、胶片摄影与燃油交通".to_owned(),
        power_rules: vec!["异常现象稀少、暧昧且不能替代证据链".to_owned()],
        factions: vec![FactionDraft {
            name: "雾港晚报".to_owned(),
            description: "依赖线人、印刷时限与公众信用的地方报社。".to_owned(),
            goals: vec!["在不牺牲来源可信度的前提下查清失踪电台。".to_owned()],
        }],
        locations: vec![LocationDraft {
            name: "雾港".to_owned(),
            description: "电车、船坞、报社与无线电塔挤在常年海雾中的工业港。".to_owned(),
            parent_name: None,
            faction_names: vec!["雾港晚报".to_owned()],
        }],
        narrative_style: "克制、证据驱动、允许误判但不锁死线索的心理悬疑。".to_owned(),
        forbidden_elements: vec![
            "照搬受版权保护规则文本".to_owned(),
            "一次失败永久锁死核心线索".to_owned(),
            "现代数字设备".to_owned(),
        ],
        tavern_reason: "夜班工人、记者和港务职员在闭店前交换消息。".to_owned(),
        story_hooks: vec!["凌晨两点的空白频段覆盖港务广播，随后一名报务员失踪。".to_owned()],
    }
}

fn investigation_career_pool(store: &CampaignStore) -> CareerPoolGenerationCommit {
    let constitution = investigation_world().constitution;
    let revision = store
        .connect()
        .expect("query investigation constitution")
        .query_row(
            "SELECT revision FROM world_constitutions WHERE campaign_id=?1 AND status='LOCKED'",
            [CAMPAIGN_ID],
            |row| row.get::<_, i64>(0),
        )
        .expect("locked investigation constitution");
    let constitution_value = json!({
        "schemaVersion":constitution.schema_version,
        "worldType":constitution.world_type,
        "era":constitution.era,
        "technology":constitution.technology,
        "magic":constitution.magic,
        "peoples":constitution.peoples,
        "society":constitution.society,
        "politics":constitution.politics,
        "economy":constitution.economy,
        "combatScale":constitution.combat_scale,
        "deathRules":constitution.death_rules,
        "careerRules":constitution.career_rules,
        "equipmentRules":constitution.equipment_rules,
        "npcRules":constitution.npc_rules,
        "traitRules":constitution.trait_rules,
        "taboos":constitution.taboos,
    });
    let evidence = json!({
        "careerRules":constitution_value["careerRules"],
        "society":constitution_value["society"],
        "technology":constitution_value["technology"],
        "economy":constitution_value["economy"],
    });
    let career = |id: &str, name: &str, rarity: &str, archetype: &str, role: &str| {
        json!({
            "id":id,
            "name":name,
            "rarity":rarity,
            "role":role,
            "skills":["档案检索","来源核验"],
            "equipmentTags":["时代工具","证物"],
            "socialPosition":"受执照、雇佣机构和公共信用约束的专业人员。",
            "relationshipHooks":["必须保护一名消息来源"],
            "risks":["错误结论会损害职业信用"],
            "requirements":["受认可的训练或雇佣记录"],
            "constitutionEvidence":evidence,
            "legacyArchetype":archetype,
        })
    };
    let output = json!({
        "schemaVersion":1,
        "careers":[
            career("night-archive-clerk","夜渡档案员","COMMON","SCHOLAR","整理港务与电台历史记录。"),
            career("signal-inspector","民用信号检验员","UNCOMMON","SCHOLAR","检查电台牌照与设备故障。"),
            career("harbor-stringer","港区特约记者","RARE","ROGUE","追踪城市边缘新闻。"),
        ]
    });
    let input = json!({
        "schemaVersion":1,
        "context":{
            "worldId":CAMPAIGN_ID,
            "constitutionRevision":revision,
            "contextSummary":constitution_value.to_string(),
        },
        "generationMode":"INITIAL",
        "requestedCount":3,
        "requestedRarities":["COMMON","UNCOMMON","RARE"],
        "existingCareerIds":[],
        "existingCareerNames":[],
    });
    CareerPoolGenerationCommit {
        campaign_id: CAMPAIGN_ID.to_owned(),
        expected_revision: 0,
        generation: character_audit(
            "career-pool",
            "GENERATE_CAREER_POOL",
            input,
            json!({
                "campaignId":CAMPAIGN_ID,
                "constitutionRevision":revision,
                "expectedPoolRevision":0,
            }),
            output,
        ),
    }
}

fn investigation_character() -> CharacterDraftInput {
    CharacterDraftInput {
        id: "investigation-character-archivist".to_owned(),
        campaign_id: CAMPAIGN_ID.to_owned(),
        name: "林岑".to_owned(),
        gender: None,
        age: Some(31),
        concept: "因一次错误索引而谨慎核验来源的夜渡档案员".to_owned(),
        story_preferences: vec!["证据链".to_owned(), "有限认知".to_owned()],
        content_boundaries: CharacterContentBoundaries {
            allow_horror: true,
            allow_permanent_death: false,
            allow_romance: false,
            allow_betrayal: true,
            excluded_content: Vec::new(),
        },
        class_archetype: "SCHOLAR".to_owned(),
        class_display_name: "夜渡档案员".to_owned(),
        attributes: CharacterAttributes {
            physique: 1,
            agility: 3,
            knowledge: 4,
            charisma: 2,
        },
        personal_goal: "证明失踪电台事件中的每项关键结论都能追溯来源。".to_owned(),
    }
}

fn install_investigation_extension(store: &CampaignStore) {
    let definition = json!({
        "kind":"WORLD_CHARACTER_EXTENSION_DEFINITION",
        "schemaVersion":1,
        "campaignId":CAMPAIGN_ID,
        "namespace":"investigation-resilience",
        "displayName":"调查状态",
        "constitutionRevision":2,
        "fields":[
            {"key":"composure","label":"镇定","required":true,"type":"INTEGER","minimum":0,"maximum":100},
            {"key":"fortune","label":"机运","required":true,"type":"INTEGER","minimum":0,"maximum":100},
            {"key":"credit","label":"信用","required":true,"type":"INTEGER","minimum":0,"maximum":100},
            {"key":"clueLoad","label":"线索负荷","required":true,"type":"INTEGER","minimum":0,"maximum":20}
        ],
        "revision":1,
        "createdAt":AT,
        "updatedAt":AT,
    });
    store
        .connect()
        .expect("install investigation extension")
        .execute(
            "INSERT INTO character_extension_definitions (
               campaign_id,namespace,schema_version,constitution_revision,definition_json,
               revision,created_at,updated_at
             ) VALUES (?1,'investigation-resilience',1,2,?2,1,?3,?3)",
            params![CAMPAIGN_ID, definition.to_string(), AT],
        )
        .expect("persist investigation extension definition");
}

fn persist_investigation_extension_values(store: &CampaignStore, character_id: &str) {
    let extensions = json!([{
        "namespace":"investigation-resilience",
        "schemaVersion":1,
        "values":{"composure":62,"fortune":48,"credit":35,"clueLoad":0}
    }]);
    let connection = store
        .connect()
        .expect("persist investigation extension values");
    let revision: i64 = connection
        .query_row(
            "SELECT revision FROM universal_character_profiles WHERE player_character_id=?1",
            [character_id],
            |row| row.get(0),
        )
        .expect("investigation universal profile");
    connection
        .execute(
            "UPDATE universal_character_profiles
             SET profile_json=json_set(
                   profile_json,
                   '$.extensions',json(?1),
                   '$.revision',?2,
                   '$.updatedAt',?3
                 ),
                 revision=?2,
                 updated_at=?3
             WHERE player_character_id=?4 AND revision=?5",
            params![
                extensions.to_string(),
                revision + 1,
                AT,
                character_id,
                revision
            ],
        )
        .expect("update investigation extension values");
}

fn assert_extension_values(
    store: &CampaignStore,
    composure: i64,
    fortune: i64,
    credit: i64,
    clue_load: i64,
) {
    let profile: String = store
        .connect()
        .expect("query investigation profile")
        .query_row(
            "SELECT profile_json FROM universal_character_profiles WHERE campaign_id=?1",
            [CAMPAIGN_ID],
            |row| row.get(0),
        )
        .expect("investigation profile JSON");
    let profile: Value = serde_json::from_str(&profile).expect("parse investigation profile JSON");
    let values = &profile["extensions"][0]["values"];
    assert_eq!(values["composure"].as_i64(), Some(composure));
    assert_eq!(values["fortune"].as_i64(), Some(fortune));
    assert_eq!(values["credit"].as_i64(), Some(credit));
    assert_eq!(values["clueLoad"].as_i64(), Some(clue_load));
}

fn generate_investigation_quest(
    store: &CampaignStore,
    publisher_id: &str,
    suffix: &str,
    title: &str,
    objective: &str,
    failure_cost: &str,
    risk: &str,
) -> String {
    let board = store
        .quest_board_snapshot(CAMPAIGN_ID)
        .expect("investigation quest board");
    let publisher = board
        .source
        .available_npcs
        .iter()
        .find(|npc| npc.id == publisher_id)
        .expect("investigation quest publisher");
    let summary = match suffix {
        "blank-frequency" => "追踪雨夜广播中反复出现、来源不明的空白频段。",
        "blacked-tide-table" => "比对港务档案中被墨迹覆盖且顺序错乱的潮位页。",
        _ => "建立一条来源可追踪、结论可复核的调查线索。",
    };
    let output = json!({
        "content":{
            "title":title,
            "summary":summary,
            "objective":objective,
            "failureCost":failure_cost,
        },
        "risk":risk,
        "recommendedAttributes":["knowledge","charisma"],
        "expectedTurns":{"min":8,"max":12},
        "rewardTier":"NOTABLE",
        "relatedNpcIds":[],
        "relatedFactIds":[],
    });
    let generated = store
        .commit_quest_generation(QuestGenerationCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            publisher_npc_id: publisher_id.to_owned(),
            generation: audit(
                &format!("quest-{suffix}"),
                "GENERATE_QUEST",
                json!({
                    "world":board.source.world,
                    "tavernName":board.source.tavern_name,
                    "publisher":publisher,
                    "availableNpcs":board.source.available_npcs,
                    "playerConcept":board.source.player_concept,
                    "recentQuestTitles":board.source.recent_quest_titles,
                    "recentQuestStructures":board.source.recent_quest_structures,
                }),
                json!({
                    "tavernId":board.source.tavern_id,
                    "playerCharacterId":board.source.player_character_id,
                    "publisherNpcId":publisher_id,
                }),
                output,
            ),
        })
        .expect("generate investigation quest");
    generated
        .quests
        .iter()
        .find(|quest| quest.content.title == title)
        .expect("new investigation quest")
        .id
        .clone()
}

fn investigation_plan_output() -> Value {
    json!({
        "objective":"确定空白频段的设备、时间与传播路径。",
        "risk":"MODERATE",
        "expectedTurns":{"min":8,"max":12},
        "coreScenes":["核对电话账单。","进入观测站记录室。","等待整点广播。"],
        "necessaryClues":[
            {"title":"错位噪声日志","description":"日期与页码不一致。","isCore":true},
            {"title":"交换台编号","description":"连接咖啡馆与观测站的旧线路。","isCore":true},
            {"title":"磁带碎片","description":"保留了呼号前的机械噪声。","isCore":true}
        ],
        "majorObstacles":["记录室封条不能破坏。"],
        "possibleEndings":["确认传播路径但保留发报者未知。","设备在审查前被转移。"],
        "failureCost":"错误结论会先行见报，但替代线索仍能推进调查。"
    })
}

fn investigation_turn_output(ending: bool, forced_failure: bool) -> Value {
    if ending {
        json!({
            "sceneText":"整点信号再次响起，交换台编号把两处记录连成可核验的传播路径。",
            "speakerNpcIds":[],
            "suggestedActions":[],
            "checkRequest":null,
            "discoveredClues":[],
            "statePatchProposals":[],
            "adventureState":"ENDING"
        })
    } else {
        json!({
            "sceneText":if forced_failure {
                "封条完好，但错位页码不足以证明改写者身份。"
            } else {
                "新的账单、日志或证词补上了一段可追溯时间线。"
            },
            "speakerNpcIds":[],
            "suggestedActions":[
                {"text":"核对来源。"},
                {"text":"寻找独立证词。"},
                {"text":"记录仍未知的部分。"}
            ],
            "checkRequest":{
                "attribute":if forced_failure { "physique" } else { "knowledge" },
                "difficulty":if forced_failure { 17 } else { 11 },
                "reason":if forced_failure {
                    "在不破坏封条的情况下证明谁改写了日期。"
                } else {
                    "把新线索接入已验证的证据链。"
                }
            },
            "discoveredClues":if forced_failure { json!([]) } else { json!(["交换台编号"]) },
            "statePatchProposals":[],
            "adventureState":"CHECK_REQUIRED"
        })
    }
}

fn investigation_settlement(
    adventure_id: &str,
    quest_id: &str,
    publisher_id: &str,
    clock_id: &str,
) -> AdventureSettlementCommit {
    AdventureSettlementCommit {
        campaign_id: CAMPAIGN_ID.to_owned(),
        adventure_id: adventure_id.to_owned(),
        outcome: "SUCCESS".to_owned(),
        summary: audit(
            "settlement-summary",
            "SUMMARIZE_ADVENTURE",
            json!({}),
            json!({"adventureId":adventure_id}),
            json!({
                "summary":"空白频段的传播路径得到验证，发报者身份仍保持未知。",
                "keyDecisions":["保留失败结论的不确定性。","没有把错误日期当作定论。"],
                "unresolvedThreads":["谁替换了记录室封条。"],
                "nextDirections":["调查被涂黑的潮位表。"],
                "npcUpdates":[{
                    "npcId":publisher_id,
                    "currentMood":"谨慎释然",
                    "relationshipPatch":{"trust":1}
                }],
                "tavernChange":{"kind":"OTHER","description":"黑板上只公布已核实的交换台编号。"},
                "statePatchProposals":[
                    {"kind":"QUEST","targetId":quest_id,"rationale":"传播路径已验证","payload":{"status":"COMPLETED"}},
                    {"kind":"RELATIONSHIP","targetId":publisher_id,"rationale":"尊重来源边界","payload":{"trust":1}},
                    {"kind":"ITEM_REWARD","targetId":null,"rationale":"保留证据链","payload":{"questId":quest_id,"name":"编号磁带盒","description":"封存空白频段原始片段。","rewardTier":"NOTABLE"}}
                ]
            }),
        ),
        world_event: audit(
            "settlement-world",
            "GENERATE_WORLD_EVENT",
            json!({}),
            json!({"adventureId":adventure_id}),
            json!({
                "title":"清晨复核",
                "description":"报社暂缓刊登未经核实的发报者身份。",
                "newFacts":["空白频段经过旧交换台线路。"],
                "clockAdvances":[{"clockId":clock_id,"amount":1,"reason":"调查跨过清晨。"}]
            }),
        ),
        equipment: audit(
            "settlement-equipment",
            "GENERATE_ITEMS",
            json!({
                "schemaVersion":1,
                "context":{"worldId":CAMPAIGN_ID,"constitutionRevision":2,"contextSummary":"雾港调查"},
                "purpose":"Quest reward",
                "requestedCount":1,
                "requestedRarity":"NOTABLE",
                "source":{"kind":"QUEST_REWARD","questId":quest_id,"adventureId":adventure_id},
                "bindingTargets":[
                    {"kind":"QUEST","targetId":quest_id,"allowedTriggers":["QUEST_CONTEXT"],"summary":"空白频段调查"},
                    {"kind":"NPC","targetId":publisher_id,"allowedTriggers":["NPC_RECOGNITION"],"summary":"伊芙琳见证封存"},
                    {"kind":"WORLD_FACT","targetId":format!("settlement-fact:{adventure_id}:0"),"allowedTriggers":["FACT_EVIDENCE"],"summary":"交换台路径"}
                ],
                "constitutionEvidence":{
                    "equipmentRules":"时代工具脆弱且用途具体，证据物不得变成通用加成",
                    "technology":"有线电话、真空管电台、胶片摄影与燃油交通",
                    "economy":"现金、工资与社会信用共同限制调查资源"
                },
                "existingItemIds":[],
                "existingItemNames":[]
            }),
            json!({"adventureId":adventure_id}),
            json!({"schemaVersion":1,"items":[{
                "id":format!("reward-semantic-{adventure_id}"),
                "name":"编号磁带盒",
                "description":"封存空白频段原始片段的逐项编号证物盒。",
                "category":"CLUE",
                "appearance":"蜡封纸带绕过深色硬纸盒。",
                "history":"由潮痕咖啡馆、观测站与报社三方共同封存。",
                "origin":"雾港旧交换台。",
                "narrativeAbilities":["证明原始片段未被替换"],
                "semanticEffects":["维持证据交接链"],
                "balanceTags":["NON_COMBAT"],
                "bindings":[
                    {"kind":"QUEST","targetId":quest_id,"trigger":"QUEST_CONTEXT","summary":"来自空白频段调查。"},
                    {"kind":"NPC","targetId":publisher_id,"trigger":"NPC_RECOGNITION","summary":"伊芙琳认得三方封条。"},
                    {"kind":"WORLD_FACT","targetId":format!("settlement-fact:{adventure_id}:0"),"trigger":"FACT_EVIDENCE","summary":"记录旧交换台传播路径。"}
                ],
                "constitutionEvidence":{
                    "equipmentRules":"时代工具脆弱且用途具体，证据物不得变成通用加成",
                    "technology":"有线电话、真空管电台、胶片摄影与燃油交通",
                    "economy":"现金、工资与社会信用共同限制调查资源"
                }
            }]}),
        ),
    }
}

fn investigation_dialogue(
    snapshot: &NpcDialogueSnapshot,
    npc_id: &str,
    index: usize,
    player_message: &str,
) -> NpcDialogueCommit {
    let reply = if index == 1 {
        "我亲耳听见呼号，但地下室发报机只是传闻；我不知道信号源。"
    } else {
        "我没有把家庭关系告诉罗兹，也不知道他是否从别处得知。"
    };
    let output = json!({
        "reply":reply,
        "mood":"防备",
        "suggestedTopics":["电话账单","信号来源"],
        "memoryCandidate":null,
        "relationshipProposal":{"trust":1}
    });
    let mut input = snapshot.generation_context.clone();
    input
        .as_object_mut()
        .expect("investigation dialogue context")
        .insert("playerMessage".to_owned(), json!(player_message));
    NpcDialogueCommit {
        campaign_id: CAMPAIGN_ID.to_owned(),
        npc_id: npc_id.to_owned(),
        player_message: player_message.to_owned(),
        generation: audit(
            &format!("dialogue-{index}"),
            "NPC_REPLY",
            input,
            json!({"npcId":npc_id}),
            output,
        ),
        timeline_submission_id: None,
        timeline_attempt_id: None,
    }
}

fn apply_rule(
    store: &CampaignStore,
    character_id: &str,
    expected_revision: i64,
    suffix: &str,
    authority: RulesAuthority,
    action: RulesAction,
) {
    store
        .apply_rules_command(RulesApplyCommand {
            event_id: format!("investigation-rules-event-{suffix}"),
            idempotency_key: format!("investigation-rules:{suffix}"),
            expected_revision,
            occurred_at: format!("2026-08-27T02:{expected_revision:02}:00.000Z"),
            command: RulesCommand {
                campaign_id: CAMPAIGN_ID.to_owned(),
                player_character_id: character_id.to_owned(),
                authority,
                action,
            },
        })
        .expect("apply investigation rules action");
}

fn character_audit(
    suffix: &str,
    task: &str,
    input: Value,
    context: Value,
    output: Value,
) -> CharacterGenerationAudit {
    CharacterGenerationAudit {
        request_id: format!("investigation-character-request-{suffix}"),
        generation_record_id: format!("investigation-character-generation-{suffix}"),
        idempotency_key: format!("investigation:character:{suffix}"),
        prompt_version: match task {
            "GENERATE_NPCS" => 4,
            "NPC_REPLY" => 3,
            "GENERATE_QUEST" => 2,
            _ => 1,
        },
        input,
        context,
        request: json!({"task":task,"modelName":"ember-fake-v1"}),
        raw_response_text: output.to_string(),
        validated_output: output,
    }
}

fn audit(
    suffix: &str,
    task: &str,
    input: Value,
    context: Value,
    output: Value,
) -> TavernGenerationAudit {
    TavernGenerationAudit {
        request_id: format!("investigation-request-{suffix}"),
        generation_record_id: format!("investigation-generation-{suffix}"),
        idempotency_key: format!("investigation:{suffix}"),
        prompt_version: match task {
            "GENERATE_NPCS" => 4,
            "NPC_REPLY" => 3,
            "GENERATE_QUEST" => 2,
            _ => 1,
        },
        input,
        context,
        request: json!({"task":task,"modelName":"ember-fake-v1"}),
        raw_response_text: output.to_string(),
        validated_output: output,
    }
}

fn npc_output(name: &str, identity: &str, personality: &str, goal: &str, secret: &str) -> Value {
    json!({
        "name":name,
        "identity":identity,
        "appearance":format!("{name} wears practical rain-darkened clothes."),
        "personality":personality,
        "goal":goal,
        "secret":secret,
        "speechStyle":format!("{name}会区分亲历、转述与未知，不把推测说成事实。"),
        "currentMood":"警觉"
    })
}

fn roster_npc(
    residency: &str,
    name: &str,
    identity: &str,
    personality: &str,
    goal: &str,
    secret: &str,
    visit_reason: Value,
) -> Value {
    let mut npc = npc_output(name, identity, personality, goal, secret);
    npc["residency"] = json!(residency);
    npc["visitReason"] = visit_reason;
    npc
}
