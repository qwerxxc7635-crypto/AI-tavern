use serde_json::{Value, json};

use super::*;

const CAMPAIGN_ID: &str = "playtest-m11-cyberpunk";
const AT: &str = "2026-08-27T02:00:00.000Z";

#[test]
fn completes_the_cyberpunk_vertical_slice_on_one_persistent_save() {
    let directory = tempfile::tempdir().expect("temporary cyberpunk directory");
    let database_path = std::env::var_os("EMBER_CYBERPUNK_PLAYTEST_DATABASE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| directory.path().join("cyberpunk.sqlite"));
    let archive_path = std::env::var_os("EMBER_CYBERPUNK_PLAYTEST_ARCHIVE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| directory.path().join("cyberpunk.emtavern"));
    if let Some(parent) = database_path.parent() {
        std::fs::create_dir_all(parent).expect("create cyberpunk database directory");
    }
    if let Some(parent) = archive_path.parent() {
        std::fs::create_dir_all(parent).expect("create cyberpunk archive directory");
    }

    let store = CampaignStore::open(&database_path).expect("open cyberpunk database");
    store
        .create_at(CAMPAIGN_ID.to_owned(), AT.to_owned())
        .expect("create cyberpunk campaign");
    let world = cyberpunk_world();
    let world_output = serde_json::to_value(&world).expect("serialize cyberpunk world");
    store
        .commit_world_generation(WorldGenerationCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            task: WorldGenerationTask::GenerateWorld,
            request_id: "cyberpunk-world-request".to_owned(),
            generation_record_id: "cyberpunk-world-generation".to_owned(),
            idempotency_key: "cyberpunk:world".to_owned(),
            prompt_version: 1,
            input: json!({"theme":"霓虹堤岸的断网夜"}),
            request: json!({"task":"GENERATE_WORLD","modelName":"ember-fake-v1"}),
            raw_response_text: world_output.to_string(),
            validated_output: world_output,
            world: world.clone(),
        })
        .expect("generate cyberpunk world");
    store
        .update_world_draft(WorldManualUpdate {
            campaign_id: CAMPAIGN_ID.to_owned(),
            world,
            locked_fields: vec!["name".to_owned(), "powerRules".to_owned()],
        })
        .expect("lock cyberpunk world fields");
    store
        .confirm_world(CAMPAIGN_ID)
        .expect("confirm cyberpunk world");
    install_cyberpunk_extension(&store);

    let careers = store
        .commit_career_pool_generation(cyberpunk_career_pool(&store))
        .expect("generate cyberpunk career pool");
    assert_eq!(careers.careers.len(), 3);

    let character = cyberpunk_character();
    let trait_output = json!({
        "traits": [
            {"name":"热插拔直觉","description":"能快速切换接口协议，但会积累短时神经回响。"},
            {"name":"街区欠账","description":"许多人愿意提供小帮助，也会要求兑现旧人情。"},
            {"name":"离线路感","description":"能在城市网格失效时保持方向。"},
            {"name":"低温耐受","description":"适应冷却设备附近的短时工作。"},
            {"name":"权限洁癖","description":"不会混用来源不明的访问令牌。"},
            {"name":"快递礼仪","description":"先确认交接人再暴露包裹内容。"}
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
        .expect("generate cyberpunk traits");
    let selected_traits = traits.trait_candidates[..2].to_vec();
    let trait_generation_record_id = traits
        .trait_generation_record_id
        .expect("cyberpunk trait generation record");
    let background_output = json!({
        "birthplace":"七码头互助街区",
        "formativeExperience":"在一次区域断网中徒步送达社区医院的离线密钥。",
        "adventureMotivation":"阻止企业回收队锁死社区备用网。",
        "secret":"曾为缩短路线使用过一枚来源不明的临时权限片。",
        "importantPerson":"维护旧磁轨节点的街诊修补师。",
        "tavernArrivalReason":"把离线密钥送到余温中继站并确认三方交接。",
        "initialEquipment":[
            {"name":"低温信号隔离套","description":"包裹实体密钥并抑制短程追踪的冷却套。"},
            {"name":"折叠电弧扳手","description":"维修电力节点的低功率绝缘工具。"}
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
        .expect("propose cyberpunk character");
    let completed_character = store
        .confirm_character_candidate(CharacterCandidateConfirm {
            campaign_id: CAMPAIGN_ID.to_owned(),
            candidate_id: proposed.candidate.expect("cyberpunk candidate").id,
        })
        .expect("confirm cyberpunk character");
    let player_character_id = completed_character
        .character
        .as_ref()
        .expect("confirmed cyberpunk character")
        .draft
        .id
        .clone();
    persist_cyberpunk_extension_values(&store, &player_character_id);

    let source = store
        .tavern_snapshot(CAMPAIGN_ID)
        .expect("cyberpunk tavern source")
        .source;
    let tavern_output = json!({
        "name":"余温中继站",
        "position":"旧磁轨换乘层与七码头社区网格之间",
        "environment":"备用电池给低功耗路由器供电，冷却管沿着隔音墙缓慢结霜。",
        "specialRules":["交接实体密钥前必须离线核对持有者。"],
        "longTermProblem":"区域主网断开后，企业回收队正逐段接管社区备用节点。",
        "owner":npc_output(
            "岚",
            "余温中继站修补师",
            "务实、对企业承诺怀疑",
            "让街区在断网后保持自治",
            "她留有一份备用网后门映射"
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
        .expect("generate cyberpunk tavern");
    let tavern_id = tavern.tavern.expect("cyberpunk tavern").id;
    let snapshot = store.tavern_snapshot(CAMPAIGN_ID).expect("tavern snapshot");
    let source = snapshot.source;
    let tavern = snapshot.tavern.expect("stored cyberpunk tavern");
    let owner = snapshot.npcs.first().expect("cyberpunk owner");
    let roster_output = json!({
        "npcs":[
            roster_npc("RESIDENT","佐藤","七码头街医","温和但严格计算风险","维持诊所的冷却配额","他替一名公司逃员更换过身份芯片",Value::Null),
            roster_npc("RESIDENT","鸢","平台外卖骑手与消息掮客","健谈、会保护长期客户","提高街区声望以脱离平台债务","他向两个派系出售过同一条路线",Value::Null),
            roster_npc("TEMPORARY_VISITOR","断网巡检员","社区节点巡检承包者","寡言、只认可离线签名","在换班前确认七码头供电","携带一份已过期的企业维护令牌",json!("等待备用电网完成切换。"))
        ],
        "rumors":[
            {"statement":"栖桥公司正在免费回收所有旧式义体。","sourceNpcName":"断网巡检员","sourceBasis":"HEARSAY","confidence":0.3,"veracity":"FALSE"},
            {"statement":"七码头备用节点仍在间歇发送心跳。","sourceNpcName":"佐藤","sourceBasis":"WITNESS","confidence":0.7,"veracity":"PARTIAL"},
            {"statement":"骑手频道记录了回收队改道旧磁轨的时间。","sourceNpcName":"鸢","sourceBasis":"FACTION_MESSAGE","confidence":0.85,"veracity":"TRUE"}
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
        .expect("generate cyberpunk roster");
    assert_eq!(completed_tavern.campaign_state, "TAVERN");
    assert_eq!(completed_tavern.npcs.len(), 4);
    let owner_id = completed_tavern
        .tavern
        .expect("complete cyberpunk tavern")
        .owner_npc_id;

    run_cyberpunk_play(
        &store,
        &database_path,
        &archive_path,
        &player_character_id,
        &owner_id,
    );
}

fn run_cyberpunk_play(
    store: &CampaignStore,
    database_path: &std::path::Path,
    archive_path: &std::path::Path,
    player_character_id: &str,
    owner_id: &str,
) {
    let roster = store
        .tavern_snapshot(CAMPAIGN_ID)
        .expect("cyberpunk roster");
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
            operation_id: "cyberpunk-population-project".to_owned(),
            cycle_id: "cyberpunk-population-cycle".to_owned(),
        })
        .expect("project cyberpunk population");
    assert_eq!(population.state.expect("population state").revision, 1);
    for (index, npc_id) in scene_npc_ids.iter().enumerate() {
        store
            .focus_tavern_population(TavernPopulationFocusCommand {
                campaign_id: CAMPAIGN_ID.to_owned(),
                npc_id: npc_id.clone(),
                expected_revision: index as i64 + 1,
                operation_id: format!("cyberpunk-focus-op-{index}"),
                event_id: format!("cyberpunk-focus-event-{index}"),
            })
            .expect("focus cyberpunk scene participant");
    }
    store
        .start_tavern_scene(TavernSceneStart {
            campaign_id: CAMPAIGN_ID.to_owned(),
            scene_id: "cyberpunk-cafe-scene".to_owned(),
            operation_id: "cyberpunk-cafe-scene-start".to_owned(),
            participant_npc_ids: scene_npc_ids,
            listening_npc_ids: Vec::new(),
        })
        .expect("start cyberpunk scene");
    let scene_intent = "Ask who verified the offline key without exposing its current holder.";
    let prepared_scene = store
        .prepare_tavern_scene_turn(TavernScenePrepare {
            campaign_id: CAMPAIGN_ID.to_owned(),
            scene_id: "cyberpunk-cafe-scene".to_owned(),
            player_intent: scene_intent.to_owned(),
            addressed_npc_id: Some(owner_id.to_owned()),
        })
        .expect("prepare cyberpunk scene");
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
                "utterance":if speaks { Some("I verified its outer signature offline, but I do not know the original holder.") } else { None },
                "citedKnowledgeIds":[],
                "urgency":if speaks { 2 } else { 0 },
                "rationale":if speaks { "Separate the verified signature from the unknown holder." } else { "The addressed technician answers first." },
            });
            TavernSceneActorGeneration {
                actor_id: actor.actor_id.clone(),
                generation: character_audit(
                    &format!("scene-{index}"),
                    "PROPOSE_TAVERN_SCENE_ACTION",
                    actor.input.clone(),
                    json!({"actorId":actor.actor_id,"sceneId":"cyberpunk-cafe-scene"}),
                    output,
                ),
            }
        })
        .collect();
    let scene = store
        .commit_tavern_scene_turn(TavernSceneCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            scene_id: "cyberpunk-cafe-scene".to_owned(),
            expected_revision: 1,
            turn_id: "cyberpunk-cafe-scene-turn-1".to_owned(),
            operation_id: "cyberpunk-cafe-scene-turn-op-1".to_owned(),
            player_intent: scene_intent.to_owned(),
            addressed_npc_id: Some(owner_id.to_owned()),
            generations,
            timeline_submission_id: None,
            timeline_attempt_id: None,
        })
        .expect("commit cyberpunk scene");
    assert_eq!(scene.turns.len(), 1);

    let initial_dialogue = store
        .npc_dialogue_snapshot(CAMPAIGN_ID, owner_id)
        .expect("initial cyberpunk dialogue");
    let dialogue = store
        .commit_npc_dialogue(cyberpunk_dialogue(
            &initial_dialogue,
            owner_id,
            1,
            "Did the company network remotely verify this key?",
        ))
        .expect("commit bounded cyberpunk dialogue");
    assert_eq!(dialogue.messages.len(), 2);

    let item_ids = {
        let connection = store.connect().expect("query cyberpunk equipment");
        let mut statement = connection
            .prepare(
                "SELECT id FROM items WHERE campaign_id=?1 AND owner_character_id=?2 ORDER BY id",
            )
            .expect("prepare cyberpunk equipment query");
        statement
            .query_map(params![CAMPAIGN_ID, player_character_id], |row| {
                row.get::<_, String>(0)
            })
            .expect("query cyberpunk equipment")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect cyberpunk equipment")
    };
    assert_eq!(item_ids.len(), 2);
    apply_rule(
        store,
        player_character_id,
        1,
        "equip-signal-sleeve",
        RulesAuthority::PlayerAction,
        RulesAction::EquipItem {
            item_id: item_ids[0].clone(),
        },
    );
    apply_rule(
        store,
        player_character_id,
        2,
        "sell-standard-battery",
        RulesAuthority::LocalRule,
        RulesAction::ChangeMoney { delta: 20 },
    );
    apply_rule(
        store,
        player_character_id,
        3,
        "maglev-to-seven-dock",
        RulesAuthority::LocalRule,
        RulesAction::AdvanceTime { minutes: 45 },
    );
    apply_rule(
        store,
        player_character_id,
        4,
        "unequip-signal-sleeve",
        RulesAuthority::PlayerAction,
        RulesAction::UnequipItem {
            item_id: item_ids[0].clone(),
        },
    );
    apply_rule(
        store,
        player_character_id,
        5,
        "equip-arc-wrench",
        RulesAuthority::PlayerAction,
        RulesAction::EquipItem {
            item_id: item_ids[1].clone(),
        },
    );
    apply_rule(
        store,
        player_character_id,
        6,
        "buy-cooling-gel",
        RulesAuthority::LocalRule,
        RulesAction::ChangeMoney { delta: -5 },
    );
    apply_rule(
        store,
        player_character_id,
        7,
        "wait-for-grid-switch",
        RulesAuthority::LocalRule,
        RulesAction::AdvanceTime { minutes: 480 },
    );
    apply_rule(
        store,
        player_character_id,
        8,
        "neural-echo-before-isolation-gate",
        RulesAuthority::LocalRule,
        RulesAction::AddStatus {
            status: RuleStatus {
                id: "cyberpunk-neural-echo".to_owned(),
                kind: RuleStatusKind::Debuff,
                label: "神经回响".to_owned(),
                attribute_modifiers: std::collections::BTreeMap::from([(
                    "physique".to_owned(),
                    -5,
                )]),
                expires_at_game_minute: Some(600),
            },
        },
    );
    let rule_state = store
        .character_rules_state(player_character_id)
        .expect("cyberpunk rules state");
    assert_eq!(rule_state.money, 15);
    assert_eq!(rule_state.game_time_minutes, 525);
    assert_eq!(rule_state.equipped_item_ids, vec![item_ids[1].clone()]);
    assert_extension_values(store, 2, 8, 0, 1);

    let locations = store
        .dynamic_location_snapshot(CAMPAIGN_ID)
        .expect("cyberpunk location graph");
    let origin_location_id = locations.state.current_location_id.clone();
    let generation = store
        .dynamic_location_generation_snapshot(DynamicLocationGenerationRequest {
            campaign_id: CAMPAIGN_ID.to_owned(),
            origin_location_id: origin_location_id.clone(),
            expansion_mode: "CONNECTED".to_owned(),
            requested_count: 1,
        })
        .expect("prepare seven dock location");
    let location_output = json!({
        "schemaVersion":1,
        "locations":[{
            "id":"cyberpunk-seven-dock-node",
            "name":"七码头离线节点",
            "kind":"DISTRICT",
            "parentLocationId":null,
            "description":"模块住宅之间的旧配电层保存着社区备用网的离线心跳。",
            "atmosphere":"应急灯把潮湿走廊切成红色区段，冷却风扇间歇重启。",
            "features":["隔离签名终端","手动配电闸"],
            "factionIds":[],
            "connections":[origin_location_id],
            "currentSituation":"企业回收队与社区巡检员都在等待节点重新上线。",
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
                "seven-dock-node",
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
        .expect("commit seven dock location");
    store
        .travel_dynamic_location(DynamicLocationTravelCommand {
            campaign_id: CAMPAIGN_ID.to_owned(),
            target_location_id: "cyberpunk-seven-dock-node".to_owned(),
            expected_revision: 1,
            mode: "ROAD".to_owned(),
            event_id: "cyberpunk-travel-seven-dock".to_owned(),
            operation_id: "cyberpunk-travel-seven-dock-op".to_owned(),
        })
        .expect("travel to seven dock");
    activate_and_expand_cyberpunk_faction(store, "cyberpunk-seven-dock-node");

    let first_quest_id = generate_cyberpunk_quest(
        store,
        owner_id,
        "deliver-offline-key",
        "送达离线密钥",
        "在不泄露持有者的前提下完成密钥交接。",
        "公司回收队将锁死社区备用网。",
        "HIGH",
    );
    store
        .accept_quest(CAMPAIGN_ID, &first_quest_id)
        .expect("accept offline key quest");
    let second_quest_id = generate_cyberpunk_quest(
        store,
        owner_id,
        "last-node-heartbeat",
        "失联节点的最后心跳",
        "确认节点失联是故障、封锁还是背叛。",
        "街区间互信和配额分配将继续恶化。",
        "EXTREME",
    );
    store
        .accept_quest(CAMPAIGN_ID, &second_quest_id)
        .expect("accept node heartbeat quest");

    let preparation = store
        .adventure_snapshot(CAMPAIGN_ID, Some(&first_quest_id))
        .expect("prepare cyberpunk adventure");
    let planned = store
        .commit_adventure_plan(AdventurePlanCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            quest_id: first_quest_id.clone(),
            generation: audit(
                "plan",
                "GENERATE_ADVENTURE_PLAN",
                preparation.plan_input,
                json!({"questId":first_quest_id,"playerCharacterId":player_character_id}),
                cyberpunk_plan_output(),
            ),
        })
        .expect("plan cyberpunk adventure");
    let adventure_id = planned.adventure_id.expect("cyberpunk adventure id");
    store
        .start_adventure(CAMPAIGN_ID, &adventure_id)
        .expect("start cyberpunk adventure");
    let mut ending = None;
    let mut first_check_failed = false;
    for turn_number in 1..=8 {
        let pending = store
            .submit_adventure_action(AdventureActionSubmit {
                campaign_id: CAMPAIGN_ID.to_owned(),
                adventure_id: adventure_id.clone(),
                action_mode: "ACTION".to_owned(),
                player_action: if turn_number == 1 {
                    "Move the isolation gate without bypassing its local safety lock.".to_owned()
                } else {
                    format!("Follow cyberpunk lead {turn_number}")
                },
            })
            .expect("submit cyberpunk action after any prior failure");
        let turn_id = pending
            .turns
            .last()
            .and_then(|turn| turn.get("id"))
            .and_then(Value::as_str)
            .expect("cyberpunk turn id")
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
                        .expect("cyberpunk turn context"),
                    json!({"adventureId":adventure_id,"turnId":turn_id}),
                    cyberpunk_turn_output(is_ending, turn_number == 1),
                ),
            })
            .expect("commit cyberpunk turn");
        if is_ending {
            ending = Some(committed);
        } else {
            let rolled = store
                .roll_adventure_check(CAMPAIGN_ID, &adventure_id)
                .expect("roll cyberpunk D20");
            if turn_number == 1 {
                first_check_failed = !rolled
                    .turns
                    .last()
                    .and_then(|turn| turn.get("diceResult"))
                    .and_then(|dice| dice.get("success"))
                    .and_then(Value::as_bool)
                    .expect("first cyberpunk hard result");
            }
            store
                .commit_adventure_dice(AdventureDiceCommit {
                    campaign_id: CAMPAIGN_ID.to_owned(),
                    adventure_id: adventure_id.clone(),
                    generation: audit(
                        &format!("dice-{turn_number}"),
                        "RESOLVE_DICE_RESULT",
                        rolled.dice_generation_input.expect("cyberpunk dice input"),
                        json!({"adventureId":adventure_id,"turnId":turn_id}),
                        if turn_number == 1 {
                            json!({
                                "narration":"隔离门没有被强行短接，但神经回响迫使快递员停下。",
                                "consequence":"失败增加时间压力，同时终端仍显示可验证的离线签名。",
                                "statePatchProposals":[],
                            })
                        } else {
                            json!({
                                "narration":"新的节点记录把密钥交接推进到下一层权限。",
                                "consequence":"行动继续，负荷、热度和权限边界仍按本地规则保留。",
                                "statePatchProposals":[],
                            })
                        },
                    ),
                })
                .expect("commit cyberpunk D20 consequence");
        }
    }
    assert!(
        first_check_failed,
        "difficulty 17 plus the active neural-echo modifier must produce the failed action"
    );
    assert_eq!(ending.expect("cyberpunk ending").current_turn_number, 8);

    store
        .travel_dynamic_location(DynamicLocationTravelCommand {
            campaign_id: CAMPAIGN_ID.to_owned(),
            target_location_id: origin_location_id,
            expected_revision: 2,
            mode: "ROAD".to_owned(),
            event_id: "cyberpunk-travel-return".to_owned(),
            operation_id: "cyberpunk-travel-return-op".to_owned(),
        })
        .expect("return to relay station");
    let clock_id = store
        .tavern_snapshot(CAMPAIGN_ID)
        .expect("cyberpunk settlement clock")
        .clocks[0]
        .id
        .clone();
    store
        .commit_adventure_settlement(cyberpunk_settlement(
            &adventure_id,
            &first_quest_id,
            owner_id,
            &clock_id,
        ))
        .expect("settle cyberpunk adventure");
    let quest_connection = store.connect().expect("query cyberpunk quest states");
    let quest_status = |quest_id: &str| {
        quest_connection
            .query_row(
                "SELECT status FROM quest_pool_states WHERE campaign_id=?1 AND quest_id=?2",
                params![CAMPAIGN_ID, quest_id],
                |row| row.get::<_, String>(0),
            )
            .expect("cyberpunk quest status")
    };
    assert_eq!(quest_status(&first_quest_id), "COMPLETED");
    assert_eq!(quest_status(&second_quest_id), "ACCEPTED");
    drop(quest_connection);

    let director = store
        .prepare_world_director(WorldDirectorPrepareCommand {
            campaign_id: CAMPAIGN_ID.to_owned(),
        })
        .expect("prepare cyberpunk director");
    store
        .commit_world_director(WorldDirectorCommitCommand {
            id: "cyberpunk-director-after-dawn".to_owned(),
            campaign_id: CAMPAIGN_ID.to_owned(),
            trigger: WorldDirectorTrigger {
                kind: "MANUAL".to_owned(),
                id: "cyberpunk-director-manual".to_owned(),
            },
            expected_context_digest: director.context_digest,
            occurred_at: "2026-08-27T03:00:00.000Z".to_owned(),
        })
        .expect("commit cyberpunk director");

    let second_dialogue_snapshot = store
        .npc_dialogue_snapshot(CAMPAIGN_ID, owner_id)
        .expect("continued cyberpunk dialogue");
    let second_dialogue = store
        .commit_npc_dialogue(cyberpunk_dialogue(
            &second_dialogue_snapshot,
            owner_id,
            2,
            "Did Sato receive your private backdoor map?",
        ))
        .expect("commit limited-knowledge follow-up");
    assert_eq!(second_dialogue.messages.len(), 4);
    drop(second_dialogue);

    let reopened = CampaignStore::open(database_path).expect("reopen cyberpunk save");
    assert_eq!(
        reopened
            .continue_campaign(CAMPAIGN_ID)
            .expect("continue save")
            .state,
        "TAVERN"
    );
    assert_extension_values(&reopened, 2, 8, 0, 1);
    reopened
        .connect()
        .expect("seed cyberpunk interrupted request")
        .execute(
            "INSERT INTO pending_ai_requests (
               id,campaign_id,turn_id,idempotency_key,task,status,model_profile_id,
               input_json,context_json,attempt_count,last_error_json,created_at,updated_at
             ) VALUES (?1,?2,NULL,?3,'NPC_REPLY','SENDING',NULL,'{}','{}',1,NULL,?4,?4)",
            params![
                "cyberpunk-interrupted-request",
                CAMPAIGN_ID,
                "cyberpunk:interrupted-request",
                "2026-08-27T03:10:00.000Z"
            ],
        )
        .expect("persist cyberpunk interrupted request");
    reopened
        .connect()
        .expect("mark cyberpunk recovery")
        .execute(
            "UPDATE campaigns SET state='RECOVERY_REQUIRED',resume_state='TAVERN' WHERE id=?1",
            [CAMPAIGN_ID],
        )
        .expect("mark recovery required");
    drop(reopened);

    let recovered = CampaignStore::open(database_path).expect("reopen failed cyberpunk save");
    assert_eq!(
        recovered
            .campaign_recovery(CAMPAIGN_ID)
            .expect("inspect cyberpunk recovery")
            .unfinished_request_count,
        1
    );
    recovered
        .restore_campaign_after_failure(CAMPAIGN_ID)
        .expect("restore cyberpunk campaign");
    recovered
        .export_campaign_archive(CAMPAIGN_ID, archive_path, "0.1.0")
        .expect("export cyberpunk archive");
    recovered
        .import_campaign_archive(archive_path, CampaignArchiveImportMode::Overwrite)
        .expect("overwrite cyberpunk archive");
    drop(recovered);

    let imported = CampaignStore::open(database_path).expect("reopen imported cyberpunk save");
    assert_eq!(
        imported
            .continue_campaign(CAMPAIGN_ID)
            .expect("continue import")
            .state,
        "TAVERN"
    );
    assert_extension_values(&imported, 2, 8, 0, 1);
    assert_eq!(
        imported
            .npc_dialogue_snapshot(CAMPAIGN_ID, owner_id)
            .expect("imported cyberpunk dialogue")
            .messages
            .len(),
        4
    );
    assert_eq!(
        imported
            .list_adventure_archives(CAMPAIGN_ID)
            .expect("cyberpunk archives")
            .len(),
        1
    );
    let imported_factions = imported
        .active_faction_snapshot(CAMPAIGN_ID)
        .expect("imported cyberpunk factions");
    assert_eq!(imported_factions.action_history.len(), 1);
    assert_eq!(
        imported_factions
            .factions
            .iter()
            .filter(|faction| faction.materialization == "ACTIVE")
            .count(),
        2
    );
}

fn activate_and_expand_cyberpunk_faction(store: &CampaignStore, target_location_id: &str) {
    let outline = store
        .active_faction_snapshot(CAMPAIGN_ID)
        .expect("cyberpunk faction outlines");
    let requested = ["七码头互助网", "栖桥公司"]
        .iter()
        .map(|name| {
            outline
                .factions
                .iter()
                .find(|faction| faction.name == *name)
                .expect("required cyberpunk faction")
                .id
                .clone()
        })
        .collect::<Vec<_>>();
    let generation = store
        .active_faction_generation_snapshot(ActiveFactionGenerationRequest {
            campaign_id: CAMPAIGN_ID.to_owned(),
            requested_faction_ids: requested.clone(),
        })
        .expect("prepare cyberpunk factions");
    let output = json!({
        "schemaVersion":1,
        "factions":generation.factions.factions.iter()
            .filter(|faction| requested.contains(&faction.id))
            .map(|faction| json!({
                "id":faction.id,
                "name":faction.name,
                "goal":faction.goal,
                "resources":if faction.name == "七码头互助网" { json!(["社区巡检凭证"]) } else { json!(["维修许可"]) },
                "leadership":if faction.name == "七码头互助网" { json!(["轮值节点议事组"]) } else { json!(["海堤维护平台主管"]) },
                "enemyFactionIds":faction.enemy_faction_ids,
                "allyFactionIds":faction.ally_faction_ids,
                "territoryLocationIds":faction.territory_location_ids,
                "currentAction":if faction.name == "七码头互助网" { "核验七码头离线心跳。" } else { "调度回收队等待维护授权。" },
                "playerRelation":faction.player_relation,
                "constitutionEvidence":generation.input["constitutionEvidence"],
            }))
            .collect::<Vec<_>>()
    });
    let active = store
        .commit_active_faction_generation(ActiveFactionGenerationCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            requested_faction_ids: requested.clone(),
            generation: character_audit(
                "active-factions",
                "GENERATE_FACTIONS",
                generation.input,
                json!({
                    "campaignId":CAMPAIGN_ID,
                    "requestedFactionIds":requested,
                }),
                output,
            ),
        })
        .expect("activate cyberpunk factions");
    let community = active
        .factions
        .iter()
        .find(|faction| faction.name == "七码头互助网")
        .expect("active community faction");
    let acted = store
        .apply_faction_action(FactionActionCommand {
            event_id: "cyberpunk-faction-expand-event".to_owned(),
            operation_id: "cyberpunk-faction-expand-operation".to_owned(),
            campaign_id: CAMPAIGN_ID.to_owned(),
            expected_revision: community.revision,
            proposal: FactionActionProposal {
                id: "cyberpunk-faction-expand-proposal".to_owned(),
                faction_id: community.id.clone(),
                kind: "EXPAND_TERRITORY".to_owned(),
                source: "PLAYER".to_owned(),
                summary: "社区巡检员把七码头离线节点纳入公开审计。".to_owned(),
                required_resources: vec!["社区巡检凭证".to_owned()],
                target_faction_id: None,
                target_location_id: Some(target_location_id.to_owned()),
                target_quest_id: None,
                consequences: vec![
                    FactionActionConsequence::TerritoryAdd {
                        location_id: target_location_id.to_owned(),
                    },
                    FactionActionConsequence::PlayerRelationSet {
                        relation: "FRIENDLY".to_owned(),
                    },
                    FactionActionConsequence::WorldFact {
                        statement: "七码头离线节点开始发布公开审计日志。".to_owned(),
                        location_id: Some(target_location_id.to_owned()),
                    },
                ],
            },
            budget: FactionActionBudget {
                decision_id: "cyberpunk-faction-expand-budget".to_owned(),
                action_points: 5,
                quest_changes: 0,
                world_facts: 1,
            },
            world_fact_id: Some("cyberpunk-faction-audit-fact".to_owned()),
        })
        .expect("expand cyberpunk community faction");
    assert_eq!(acted.action_history.len(), 1);
    let community = acted
        .factions
        .iter()
        .find(|faction| faction.name == "七码头互助网")
        .expect("expanded community faction");
    assert!(
        community
            .territory_location_ids
            .contains(&target_location_id.to_owned())
    );
    assert_eq!(community.player_relation, "FRIENDLY");
}

fn cyberpunk_world() -> WorldDraft {
    WorldDraft {
        constitution: WorldConstitutionDraft {
            schema_version: 1,
            world_type: "社区视角的近未来赛博都市".to_owned(),
            era: "二〇八九年海堤巨城的企业自治年代".to_owned(),
            technology: "神经接口、自治无人机、局域网格与模块化义体".to_owned(),
            magic: "不存在超自然魔法；异常必须有技术、社会或认知来源".to_owned(),
            peoples: vec![
                "自然人".to_owned(),
                "义体适配者".to_owned(),
                "离线社区居民".to_owned(),
            ],
            society: "企业辖区、互助街区和平台劳工依赖不稳定基础设施".to_owned(),
            politics: "栖桥公司、市政残余与社区节点争夺网络控制权".to_owned(),
            economy: "信用点、配额、声望交换和维修债务共同流通".to_owned(),
            combat_scale: "个人和小队行动；热度、弹药、负荷与医疗成本持续累积".to_owned(),
            death_rules: "死亡永久；人格备份不能等同本人复活".to_owned(),
            career_rules: "职业由接入权限、平台评级、街区关系和技能认证决定".to_owned(),
            equipment_rules: "义体占用插槽并累积负荷；装备价格和功率受本地规则约束".to_owned(),
            npc_rules: "NPC 拥有分层访问权限、派系利益和可追踪的信息来源".to_owned(),
            trait_rules: "技术优势必须绑定热度、负荷、维护或关系代价".to_owned(),
            taboos: vec![
                "无成本全能黑客".to_owned(),
                "无限义体插槽".to_owned(),
                "数字人格无代价复活".to_owned(),
            ],
        },
        name: "霓虹堤岸的断网夜".to_owned(),
        current_region: "海堤巨城七码头".to_owned(),
        summary: "断网后的社区节点、企业回收队与平台劳工在海堤城争夺离线控制权。".to_owned(),
        core_conflict: "栖桥公司试图以维护名义接管社区备用网，互助街区则要求共同审计。".to_owned(),
        technology_level: "神经接口、自治无人机、局域网格与模块化义体".to_owned(),
        power_rules: vec!["不存在超自然魔法；异常必须有技术、社会或认知来源".to_owned()],
        factions: vec![
            FactionDraft {
                name: "栖桥公司".to_owned(),
                description: "控制海堤主干网络、维修许可和回收队的基础设施企业。".to_owned(),
                goals: vec!["把七码头备用节点纳入公司维护网。".to_owned()],
            },
            FactionDraft {
                name: "七码头互助网".to_owned(),
                description: "由街诊、骑手与居民共同维护的离线社区网络。".to_owned(),
                goals: vec!["保持备用节点自治并公开审计访问权限。".to_owned()],
            },
            FactionDraft {
                name: "市频残余局".to_owned(),
                description: "保留过期执照和频谱档案的市政残余机构。".to_owned(),
                goals: vec!["恢复最低限度的公共频谱监管。".to_owned()],
            },
        ],
        locations: vec![LocationDraft {
            name: "海堤巨城七码头".to_owned(),
            description: "旧磁轨、模块住宅、街诊与社区节点叠在潮湿海堤上的自治街区。".to_owned(),
            parent_name: None,
            faction_names: vec!["七码头互助网".to_owned(), "栖桥公司".to_owned()],
        }],
        narrative_style: "近未来街区视角；技术后果具体，企业与社区选择都留下资源和关系代价。"
            .to_owned(),
        forbidden_elements: vec![
            "无成本全能黑客".to_owned(),
            "无限义体插槽".to_owned(),
            "数字人格无代价复活".to_owned(),
        ],
        tavern_reason: "中继站在主网断开后为骑手、街诊和居民提供离线交接点。".to_owned(),
        story_hooks: vec![
            "一枚离线密钥在断网夜抵达七码头，同时企业回收队改变了巡检路线。".to_owned(),
        ],
    }
}

fn cyberpunk_career_pool(store: &CampaignStore) -> CareerPoolGenerationCommit {
    let constitution = cyberpunk_world().constitution;
    let revision = store
        .connect()
        .expect("query cyberpunk constitution")
        .query_row(
            "SELECT revision FROM world_constitutions WHERE campaign_id=?1 AND status='LOCKED'",
            [CAMPAIGN_ID],
            |row| row.get::<_, i64>(0),
        )
        .expect("locked cyberpunk constitution");
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
            "skills":["离线路由","反追踪"],
            "equipmentTags":["模块工具","接口隔离"],
            "socialPosition":"受平台评级、接入权限和街区关系共同约束。",
            "relationshipHooks":["必须维护一个社区节点的人情债"],
            "risks":["权限滥用会增加追踪热度"],
            "requirements":["持有可离线验证的技能或街区担保"],
            "constitutionEvidence":evidence,
            "legacyArchetype":archetype,
        })
    };
    let output = json!({
        "schemaVersion":1,
        "careers":[
            career("mesh-courier","网格快递员","COMMON","ROGUE","在断续网络间运送实体密钥。"),
            career("clinic-patch-tech","街诊修补师","UNCOMMON","SCHOLAR","维护低配义体与离线医疗设备。"),
            career("civic-spectrum-auditor","市频审计员","RARE","DIPLOMAT","追查频谱与企业授权滥用。"),
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

fn cyberpunk_character() -> CharacterDraftInput {
    CharacterDraftInput {
        id: "cyberpunk-character-mesh-courier".to_owned(),
        campaign_id: CAMPAIGN_ID.to_owned(),
        name: "乔岑".to_owned(),
        gender: None,
        age: Some(27),
        concept: "依赖街区信誉、拒绝企业远程接管的网格快递员".to_owned(),
        story_preferences: vec!["社区自治".to_owned(), "技术代价".to_owned()],
        content_boundaries: CharacterContentBoundaries {
            allow_horror: true,
            allow_permanent_death: false,
            allow_romance: false,
            allow_betrayal: true,
            excluded_content: Vec::new(),
        },
        class_archetype: "ROGUE".to_owned(),
        class_display_name: "网格快递员".to_owned(),
        attributes: CharacterAttributes {
            physique: 1,
            agility: 3,
            knowledge: 4,
            charisma: 2,
        },
        personal_goal: "让离线密钥在不暴露持有者的前提下由社区三方共同托管。".to_owned(),
    }
}

fn install_cyberpunk_extension(store: &CampaignStore) {
    let definition = json!({
        "kind":"WORLD_CHARACTER_EXTENSION_DEFINITION",
        "schemaVersion":1,
        "campaignId":CAMPAIGN_ID,
        "namespace":"cyberpunk-augmentation",
        "displayName":"义体与街区状态",
        "constitutionRevision":2,
        "fields":[
            {"key":"neuralLoad","label":"神经负荷","required":true,"type":"INTEGER","minimum":0,"maximum":12},
            {"key":"streetReputation","label":"街区声望","required":true,"type":"INTEGER","minimum":-100,"maximum":100},
            {"key":"traceHeat","label":"追踪热度","required":true,"type":"INTEGER","minimum":0,"maximum":10},
            {"key":"implantSlots","label":"义体插槽","required":true,"type":"TEXT_LIST","maxItems":6,"itemMaxLength":48},
            {"key":"networkAccess","label":"网络权限","required":true,"type":"ENUM","options":["离线","社区","市政","企业"]}
        ],
        "revision":1,
        "createdAt":AT,
        "updatedAt":AT,
    });
    store
        .connect()
        .expect("install cyberpunk extension")
        .execute(
            "INSERT INTO character_extension_definitions (
               campaign_id,namespace,schema_version,constitution_revision,definition_json,
               revision,created_at,updated_at
             ) VALUES (?1,'cyberpunk-augmentation',1,2,?2,1,?3,?3)",
            params![CAMPAIGN_ID, definition.to_string(), AT],
        )
        .expect("persist cyberpunk extension definition");
}

fn persist_cyberpunk_extension_values(store: &CampaignStore, character_id: &str) {
    let extensions = json!([{
        "namespace":"cyberpunk-augmentation",
        "schemaVersion":1,
        "values":{"neuralLoad":2,"streetReputation":8,"traceHeat":0,"implantSlots":["神经桥"],"networkAccess":"社区"}
    }]);
    let connection = store.connect().expect("persist cyberpunk extension values");
    let revision: i64 = connection
        .query_row(
            "SELECT revision FROM universal_character_profiles WHERE player_character_id=?1",
            [character_id],
            |row| row.get(0),
        )
        .expect("cyberpunk universal profile");
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
        .expect("update cyberpunk extension values");
}

fn assert_extension_values(
    store: &CampaignStore,
    neural_load: i64,
    street_reputation: i64,
    trace_heat: i64,
    implant_slot_count: usize,
) {
    let profile: String = store
        .connect()
        .expect("query cyberpunk profile")
        .query_row(
            "SELECT profile_json FROM universal_character_profiles WHERE campaign_id=?1",
            [CAMPAIGN_ID],
            |row| row.get(0),
        )
        .expect("cyberpunk profile JSON");
    let profile: Value = serde_json::from_str(&profile).expect("parse cyberpunk profile JSON");
    let values = &profile["extensions"][0]["values"];
    assert_eq!(values["neuralLoad"].as_i64(), Some(neural_load));
    assert_eq!(values["streetReputation"].as_i64(), Some(street_reputation));
    assert_eq!(values["traceHeat"].as_i64(), Some(trace_heat));
    assert_eq!(
        values["implantSlots"].as_array().map(Vec::len),
        Some(implant_slot_count)
    );
    assert_eq!(values["networkAccess"].as_str(), Some("社区"));
}

fn generate_cyberpunk_quest(
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
        .expect("cyberpunk quest board");
    let publisher = board
        .source
        .available_npcs
        .iter()
        .find(|npc| npc.id == publisher_id)
        .expect("cyberpunk quest publisher");
    let summary = match suffix {
        "deliver-offline-key" => "在断网街区完成一次可离线复核且不泄露持有者的密钥交接。",
        "last-node-heartbeat" => "比对节点心跳、维护封锁和社区巡检记录的差异。",
        _ => "建立一条权限可核对、技术代价可追踪的行动路线。",
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
        .expect("generate cyberpunk quest");
    generated
        .quests
        .iter()
        .find(|quest| quest.content.title == title)
        .expect("new cyberpunk quest")
        .id
        .clone()
}

fn cyberpunk_plan_output() -> Value {
    json!({
        "objective":"把离线密钥送入七码头共同托管节点，同时隐藏当前持有者。",
        "risk":"HIGH",
        "expectedTurns":{"min":8,"max":12},
        "coreScenes":["核对隔离套签名。","穿过断电磁轨。","在离线节点完成三方交接。"],
        "necessaryClues":[
            {"title":"离线签名序列","description":"证明密钥壳体未被远程替换。","isCore":true},
            {"title":"节点心跳片段","description":"显示七码头节点仍可局部响应。","isCore":true},
            {"title":"回收队改道记录","description":"标记企业巡检路线改变的时间。","isCore":true}
        ],
        "majorObstacles":["不能绕过隔离门的本地安全锁。"],
        "possibleEndings":["社区三方完成共同托管。","公司回收队先一步锁定节点。"],
        "failureCost":"追踪热度和神经负荷增加，但替代路线仍允许任务推进。"
    })
}

fn cyberpunk_turn_output(ending: bool, forced_failure: bool) -> Value {
    if ending {
        json!({
            "sceneText":"三方离线签名依次亮起，密钥进入共同托管且没有暴露当前持有者。",
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
                "隔离门拒绝强制开启，神经回响让快递员暂时失去平衡。"
            } else {
                "节点心跳、巡检记录或权限签名补上了一段可验证路线。"
            },
            "speakerNpcIds":[],
            "suggestedActions":[
                {"text":"离线核对签名。"},
                {"text":"切换到社区节点。"},
                {"text":"记录负荷和追踪热度。"}
            ],
            "checkRequest":{
                "attribute":if forced_failure { "physique" } else { "knowledge" },
                "difficulty":if forced_failure { 17 } else { 11 },
                "reason":if forced_failure {
                    "在不短接安全锁的情况下移开隔离门。"
                } else {
                    "把新节点记录接入已验证的离线路由。"
                }
            },
            "discoveredClues":if forced_failure { json!([]) } else { json!(["节点心跳片段"]) },
            "statePatchProposals":[],
            "adventureState":"CHECK_REQUIRED"
        })
    }
}

fn cyberpunk_settlement(
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
                "summary":"离线密钥进入社区三方托管，当前持有者身份没有被上传。",
                "keyDecisions":["拒绝企业远程验证。","保留隔离门失败造成的时间代价。"],
                "unresolvedThreads":["谁向回收队泄露了旧磁轨路线。"],
                "nextDirections":["追查失联节点的最后心跳。"],
                "npcUpdates":[{
                    "npcId":publisher_id,
                    "currentMood":"警觉但认可",
                    "relationshipPatch":{"trust":1}
                }],
                "tavernChange":{"kind":"OTHER","description":"交接墙新增三方离线签名的共同托管记录。"},
                "statePatchProposals":[
                    {"kind":"QUEST","targetId":quest_id,"rationale":"离线密钥已完成共同托管","payload":{"status":"COMPLETED"}},
                    {"kind":"RELATIONSHIP","targetId":publisher_id,"rationale":"拒绝暴露当前持有者","payload":{"trust":1}},
                    {"kind":"ITEM_REWARD","targetId":null,"rationale":"保留离线审计能力","payload":{"questId":quest_id,"name":"净化访问片","description":"保留共同托管节点的最小权限签名。","rewardTier":"NOTABLE"}}
                ]
            }),
        ),
        world_event: audit(
            "settlement-world",
            "GENERATE_WORLD_EVENT",
            json!({}),
            json!({"adventureId":adventure_id}),
            json!({
                "title":"社区节点恢复心跳",
                "description":"七码头开始发布不含持有者身份的离线审计日志。",
                "newFacts":["离线密钥已由中继站、街诊与社区节点共同托管。"],
                "clockAdvances":[{"clockId":clock_id,"amount":1,"reason":"备用电网完成换班切换。"}]
            }),
        ),
        equipment: audit(
            "settlement-equipment",
            "GENERATE_ITEMS",
            json!({
                "schemaVersion":1,
                "context":{"worldId":CAMPAIGN_ID,"constitutionRevision":2,"contextSummary":"七码头离线交接"},
                "purpose":"Quest reward",
                "requestedCount":1,
                "requestedRarity":"NOTABLE",
                "source":{"kind":"QUEST_REWARD","questId":quest_id,"adventureId":adventure_id},
                "bindingTargets":[
                    {"kind":"QUEST","targetId":quest_id,"allowedTriggers":["QUEST_CONTEXT"],"summary":"离线密钥交接"},
                    {"kind":"NPC","targetId":publisher_id,"allowedTriggers":["NPC_RECOGNITION"],"summary":"岚见证共同托管"},
                    {"kind":"WORLD_FACT","targetId":format!("settlement-fact:{adventure_id}:0"),"allowedTriggers":["FACT_EVIDENCE"],"summary":"社区节点心跳"}
                ],
                "constitutionEvidence":{
                    "equipmentRules":"义体占用插槽并累积负荷；装备价格和功率受本地规则约束",
                    "technology":"神经接口、自治无人机、局域网格与模块化义体",
                    "economy":"信用点、配额、声望交换和维修债务共同流通"
                },
                "existingItemIds":[],
                "existingItemNames":[]
            }),
            json!({"adventureId":adventure_id}),
            json!({"schemaVersion":1,"items":[{
                "id":format!("reward-semantic-{adventure_id}"),
                "name":"净化访问片",
                "description":"只保留共同托管节点最小权限签名的离线存储片。",
                "category":"CLUE",
                "appearance":"透明陶瓷片内只有一条断续绿色权限纹。",
                "history":"由中继站、街诊与社区节点共同净化。",
                "origin":"七码头离线托管终端。",
                "narrativeAbilities":["证明共同托管签名没有被远程替换"],
                "semanticEffects":["只授权读取公开审计日志"],
                "balanceTags":["NON_COMBAT"],
                "bindings":[
                    {"kind":"QUEST","targetId":quest_id,"trigger":"QUEST_CONTEXT","summary":"来自离线密钥交接。"},
                    {"kind":"NPC","targetId":publisher_id,"trigger":"NPC_RECOGNITION","summary":"岚认得共同托管签名。"},
                    {"kind":"WORLD_FACT","targetId":format!("settlement-fact:{adventure_id}:0"),"trigger":"FACT_EVIDENCE","summary":"记录社区节点恢复心跳。"}
                ],
                "constitutionEvidence":{
                    "equipmentRules":"义体占用插槽并累积负荷；装备价格和功率受本地规则约束",
                    "technology":"神经接口、自治无人机、局域网格与模块化义体",
                    "economy":"信用点、配额、声望交换和维修债务共同流通"
                }
            }]}),
        ),
    }
}

fn cyberpunk_dialogue(
    snapshot: &NpcDialogueSnapshot,
    npc_id: &str,
    index: usize,
    player_message: &str,
) -> NpcDialogueCommit {
    let reply = if index == 1 {
        "我只离线核验过外壳签名；企业远程验证是他们的说法，我不知道原持有者。"
    } else {
        "我没有把后门映射交给佐藤，也不知道他是否从别的节点得到副本。"
    };
    let output = json!({
        "reply":reply,
        "mood":"防备",
        "suggestedTopics":["离线签名","访问权限"],
        "memoryCandidate":null,
        "relationshipProposal":{"trust":1}
    });
    let mut input = snapshot.generation_context.clone();
    input
        .as_object_mut()
        .expect("cyberpunk dialogue context")
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
            event_id: format!("cyberpunk-rules-event-{suffix}"),
            idempotency_key: format!("cyberpunk-rules:{suffix}"),
            expected_revision,
            occurred_at: format!("2026-08-27T02:{expected_revision:02}:00.000Z"),
            command: RulesCommand {
                campaign_id: CAMPAIGN_ID.to_owned(),
                player_character_id: character_id.to_owned(),
                authority,
                action,
            },
        })
        .expect("apply cyberpunk rules action");
}

fn character_audit(
    suffix: &str,
    task: &str,
    input: Value,
    context: Value,
    output: Value,
) -> CharacterGenerationAudit {
    CharacterGenerationAudit {
        request_id: format!("cyberpunk-character-request-{suffix}"),
        generation_record_id: format!("cyberpunk-character-generation-{suffix}"),
        idempotency_key: format!("cyberpunk:character:{suffix}"),
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
        request_id: format!("cyberpunk-request-{suffix}"),
        generation_record_id: format!("cyberpunk-generation-{suffix}"),
        idempotency_key: format!("cyberpunk:{suffix}"),
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
        "appearance":format!("{name}穿着带有离线身份片的实用街区装备。"),
        "personality":personality,
        "goal":goal,
        "secret":secret,
        "speechStyle":format!("{name}会区分本地验证、权限转述与未知，不把网络传闻说成事实。"),
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
