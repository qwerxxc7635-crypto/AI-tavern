use serde_json::{Value, json};

use super::*;

const CAMPAIGN_ID: &str = "playtest-m11-fantasy";

#[test]
fn completes_the_windows_release_vertical_slice_on_one_persistent_save() {
    let directory = tempfile::tempdir().expect("temporary release directory");
    let database_path = std::env::var_os("EMBER_FANTASY_PLAYTEST_DATABASE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| directory.path().join("ember-tavern.sqlite"));
    let archive_path = std::env::var_os("EMBER_FANTASY_PLAYTEST_ARCHIVE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| directory.path().join("windows-release.emtavern"));
    if let Some(parent) = database_path.parent() {
        std::fs::create_dir_all(parent).expect("create playtest database directory");
    }
    if let Some(parent) = archive_path.parent() {
        std::fs::create_dir_all(parent).expect("create playtest archive directory");
    }
    let store = CampaignStore::open(&database_path).expect("open release database");
    assert!(store.list().expect("first-launch campaign list").is_empty());
    assert!(
        store
            .model_settings()
            .expect("first-launch model settings")
            .profiles
            .is_empty()
    );
    store
        .create_at(
            CAMPAIGN_ID.to_owned(),
            "2026-08-01T14:00:00.000Z".to_owned(),
        )
        .expect("create campaign");
    let seed = store
        .world_seed(CAMPAIGN_ID)
        .expect("persistent world seed");
    assert_eq!(seed.algorithm, "EMBER_STREAM_V1");
    assert_eq!(seed.seed.len(), 32);
    assert_eq!(
        store
            .reserve_world_random(CAMPAIGN_ID, "map.initial", 2)
            .expect("reserve deterministic map stream")
            .start_position,
        0
    );

    let world = world_draft();
    let world_output = serde_json::to_value(&world).expect("serialize world output");
    let generated_world = store
        .commit_world_generation(WorldGenerationCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            task: WorldGenerationTask::GenerateWorld,
            request_id: "e2e-world-request".to_owned(),
            generation_record_id: "e2e-world-generation".to_owned(),
            idempotency_key: "e2e:world".to_owned(),
            prompt_version: 1,
            input: json!({"theme":"storm coast"}),
            request: json!({"task":"GENERATE_WORLD"}),
            raw_response_text: world_output.to_string(),
            validated_output: world_output,
            world: world.clone(),
        })
        .expect("generate world");
    assert_eq!(generated_world.campaign_state, "REVIEWING_WORLD");
    store
        .update_world_draft(WorldManualUpdate {
            campaign_id: CAMPAIGN_ID.to_owned(),
            world,
            locked_fields: vec!["name".to_owned(), "powerRules".to_owned()],
        })
        .expect("lock reviewed world fields");
    assert_eq!(
        store
            .confirm_world(CAMPAIGN_ID)
            .expect("confirm world")
            .campaign_state,
        "CREATING_CHARACTER"
    );
    let career_pool = store
        .commit_career_pool_generation(fantasy_career_pool_command(&store))
        .expect("generate fantasy career pool");
    assert_eq!(career_pool.careers.len(), 3);

    let character = character_draft();
    let trait_output = json!({
        "traits": [
            {"name":"余烬听觉","description":"能从火焰细响中察觉异常，但持续噪声会使判断迟疑。"},
            {"name":"誓债在身","description":"面对公开承诺时更坚定，也更难撤回已经说出口的选择。"},
            {"name":"Steady Hands","description":"Works calmly under pressure."},
            {"name":"Harborwise","description":"Knows port customs."},
            {"name":"Quiet Courage","description":"Acts despite fear."},
            {"name":"Old Maps","description":"Recognizes forgotten routes."}
        ]
    });
    let trait_input = json!({
        "concept": character.concept,
        "classArchetype": character.class_archetype,
        "personalGoal": character.personal_goal,
        "storyPreferences": character.story_preferences,
    });
    let traits = store
        .commit_character_traits(CharacterTraitGenerationCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            character: character.clone(),
            generation: character_audit(
                "traits",
                "GENERATE_CHARACTER_TRAITS",
                trait_input,
                json!({"character": character}),
                trait_output,
            ),
        })
        .expect("generate character traits");
    let selected_traits = traits.trait_candidates[..2].to_vec();
    let trait_generation_record_id = traits
        .trait_generation_record_id
        .expect("trait generation record");
    let background_output = json!({
        "birthplace":"The North Road",
        "formativeExperience":"Survived a winter crossing.",
        "adventureMotivation":"Protect travelers.",
        "secret":"Followed a false beacon.",
        "importantPerson":"A missing sibling.",
        "tavernArrivalReason":"Seeking the last caravan.",
        "initialEquipment":[
            {"name":"缺口银灯","description":"能显出特定封蜡纹路的旧灯。"},
            {"name":"荆纹短披风","description":"行会猎手使用的轻便披风。"}
        ]
    });
    let background_input = json!({
        "name": character.name,
        "concept": character.concept,
        "classDisplayName": character.class_display_name,
        "personalGoal": character.personal_goal,
        "traits": selected_traits.iter().map(|value| json!({
            "name": value.name,
            "description": value.description,
        })).collect::<Vec<_>>(),
    });
    let proposed_character = store
        .commit_character_completion(CharacterCompletionCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            character: character.clone(),
            trait_generation_record_id: trait_generation_record_id.clone(),
            selected_traits: selected_traits.clone(),
            generation: character_audit(
                "background",
                "COMPLETE_CHARACTER_BACKGROUND",
                background_input,
                json!({
                    "character": character,
                    "selectedTraits": selected_traits,
                    "traitGenerationRecordId": trait_generation_record_id,
                }),
                background_output,
            ),
        })
        .expect("propose complete character");
    assert_eq!(proposed_character.campaign_state, "CREATING_CHARACTER");
    let completed_character = store
        .confirm_character_candidate(CharacterCandidateConfirm {
            campaign_id: CAMPAIGN_ID.to_owned(),
            candidate_id: proposed_character
                .candidate
                .expect("complete character candidate")
                .id,
        })
        .expect("confirm character");
    assert_eq!(completed_character.campaign_state, "GENERATING_TAVERN");
    let player_character_id = completed_character
        .character
        .as_ref()
        .expect("confirmed player")
        .draft
        .id
        .clone();

    let source = store
        .tavern_snapshot(CAMPAIGN_ID)
        .expect("tavern source")
        .source;
    let tavern_output = json!({
        "name":"断梁酒馆",
        "position":"烛湾东门与旧盐路交会处",
        "environment":"深木梁柱围住低矮炉火，潮气从石墙缝隙渗入。",
        "specialRules":["公开立誓必须记入炉边账簿。"],
        "longTermProblem":"第三声潮钟之后，灰潮正在反常倒流。",
        "owner": npc_output("玛菈"),
    });
    let tavern = store
        .commit_tavern_generation(TavernGenerationCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            generation: audit(
                "tavern",
                "GENERATE_TAVERN",
                json!({
                    "world": source.world,
                    "playerConcept": source.player_concept,
                    "desiredPosition": source.desired_position,
                }),
                json!({"source": source}),
                tavern_output,
            ),
        })
        .expect("generate tavern");
    let tavern_id = tavern.tavern.expect("generated tavern").id;
    let tavern_snapshot = store.tavern_snapshot(CAMPAIGN_ID).expect("tavern snapshot");
    let source = tavern_snapshot.source;
    let tavern = tavern_snapshot.tavern.expect("stored tavern");
    let owner = tavern_snapshot.npcs.first().expect("owner");
    let roster_output = json!({
        "npcs": [
            roster_npc("RESIDENT", "奥尔德", Value::Null),
            roster_npc("RESIDENT", "维什", Value::Null),
            roster_npc("TEMPORARY_VISITOR", "旧盐门守卫", json!("等待退潮后返回东门。"))
        ],
        "rumors": [
            {"statement":"灰潮会在第三声钟响后倒流。","sourceNpcName":"奥尔德","sourceBasis":"WITNESS","confidence":0.9,"veracity":"TRUE"},
            {"statement":"河港行会愿为烧焦账册付银币。","sourceNpcName":"维什","sourceBasis":"FACTION_MESSAGE","confidence":0.6,"veracity":"PARTIAL"},
            {"statement":"昨夜只有巡钟人穿过旧盐门。","sourceNpcName":"旧盐门守卫","sourceBasis":"HEARSAY","confidence":0.4,"veracity":"UNKNOWN"}
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
                    "world": source.world,
                    "tavern": {
                        "name": tavern.name,
                        "position": tavern.position,
                        "environment": tavern.environment,
                        "longTermProblem": tavern.long_term_problem,
                    },
                    "existingNpcNames": [owner.name],
                    "existingNpcArchetypes": [crate::repetition::npc_archetype_signature(&owner.identity, &owner.personality)],
                    "requestedCount": 3,
                }),
                json!({"source": source, "tavernId": tavern_id}),
                roster_output,
            ),
        })
        .expect("generate tavern roster");
    assert_eq!(completed_tavern.campaign_state, "TAVERN");
    assert_eq!(completed_tavern.npcs.len(), 4);
    let owner_id = completed_tavern
        .tavern
        .expect("complete tavern")
        .owner_npc_id;
    let scene_npc_ids = completed_tavern
        .npcs
        .iter()
        .take(2)
        .map(|npc| npc.id.clone())
        .collect::<Vec<_>>();
    assert_eq!(scene_npc_ids.len(), 2);
    let projected_population = store
        .project_tavern_population(TavernPopulationProjectCommand {
            campaign_id: CAMPAIGN_ID.to_owned(),
            trigger: "ENTERED".to_owned(),
            operation_id: "fantasy-population-project".to_owned(),
            cycle_id: "fantasy-population-cycle".to_owned(),
        })
        .expect("project tavern population");
    assert_eq!(
        projected_population
            .state
            .as_ref()
            .expect("population state")
            .revision,
        1
    );
    for (index, npc_id) in scene_npc_ids.iter().enumerate() {
        store
            .focus_tavern_population(TavernPopulationFocusCommand {
                campaign_id: CAMPAIGN_ID.to_owned(),
                npc_id: npc_id.clone(),
                expected_revision: index as i64 + 1,
                operation_id: format!("fantasy-population-focus-op-{index}"),
                event_id: format!("fantasy-population-focus-{index}"),
            })
            .expect("focus tavern scene participant");
    }
    store
        .start_tavern_scene(TavernSceneStart {
            campaign_id: CAMPAIGN_ID.to_owned(),
            scene_id: "fantasy-tavern-scene".to_owned(),
            operation_id: "fantasy-tavern-scene-start".to_owned(),
            participant_npc_ids: scene_npc_ids,
            listening_npc_ids: Vec::new(),
        })
        .expect("start multi NPC tavern scene");
    let scene_intent = "Ask who witnessed the third bell after midnight.";
    let prepared_scene = store
        .prepare_tavern_scene_turn(TavernScenePrepare {
            campaign_id: CAMPAIGN_ID.to_owned(),
            scene_id: "fantasy-tavern-scene".to_owned(),
            player_intent: scene_intent.to_owned(),
            addressed_npc_id: Some(owner_id.clone()),
        })
        .expect("prepare multi NPC tavern scene turn");
    let actor_generations = prepared_scene
        .actor_inputs
        .iter()
        .enumerate()
        .map(|(index, actor)| {
            let speaks = actor.actor_id == owner_id;
            let output = json!({
                "actorId": actor.actor_id,
                "action": if speaks { "SPEAK" } else { "SILENCE" },
                "targetNpcId": null,
                "utterance": if speaks { Some("I saw only the gatekeeper leave before the third bell.") } else { None },
                "citedKnowledgeIds": [],
                "urgency": if speaks { 2 } else { 0 },
                "rationale": if speaks { "Answer the player without inventing another witness." } else { "Yield the floor to the addressed tavern keeper." },
            });
            TavernSceneActorGeneration {
                actor_id: actor.actor_id.clone(),
                generation: character_audit(
                    &format!("tavern-scene-{index}"),
                    "PROPOSE_TAVERN_SCENE_ACTION",
                    actor.input.clone(),
                    json!({"actorId":actor.actor_id,"sceneId":"fantasy-tavern-scene"}),
                    output,
                ),
            }
        })
        .collect();
    let committed_scene = store
        .commit_tavern_scene_turn(TavernSceneCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            scene_id: "fantasy-tavern-scene".to_owned(),
            expected_revision: 1,
            turn_id: "fantasy-tavern-scene-turn-1".to_owned(),
            operation_id: "fantasy-tavern-scene-turn-op-1".to_owned(),
            player_intent: scene_intent.to_owned(),
            addressed_npc_id: Some(owner_id.clone()),
            generations: actor_generations,
            timeline_submission_id: None,
            timeline_attempt_id: None,
        })
        .expect("commit multi NPC tavern scene turn");
    assert_eq!(committed_scene.turns.len(), 1);

    let owned_item_ids = {
        let connection = store.connect().expect("query initial equipment");
        let mut statement = connection
            .prepare(
                "SELECT id FROM items WHERE campaign_id=?1 AND owner_character_id=?2 ORDER BY id",
            )
            .expect("prepare initial equipment query");
        statement
            .query_map(params![CAMPAIGN_ID, player_character_id], |row| {
                row.get::<_, String>(0)
            })
            .expect("query initial equipment")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect initial equipment")
    };
    assert_eq!(owned_item_ids.len(), 2);
    apply_rules_action(
        &store,
        &player_character_id,
        1,
        "equip-lamp",
        RulesAuthority::PlayerAction,
        RulesAction::EquipItem {
            item_id: owned_item_ids[0].clone(),
        },
    );
    apply_rules_action(
        &store,
        &player_character_id,
        2,
        "sell-copper-button",
        RulesAuthority::LocalRule,
        RulesAction::ChangeMoney { delta: 15 },
    );
    apply_rules_action(
        &store,
        &player_character_id,
        3,
        "travel-to-salt-gate",
        RulesAuthority::LocalRule,
        RulesAction::AdvanceTime { minutes: 45 },
    );
    apply_rules_action(
        &store,
        &player_character_id,
        4,
        "unequip-lamp",
        RulesAuthority::PlayerAction,
        RulesAction::UnequipItem {
            item_id: owned_item_ids[0].clone(),
        },
    );
    apply_rules_action(
        &store,
        &player_character_id,
        5,
        "equip-cloak",
        RulesAuthority::PlayerAction,
        RulesAction::EquipItem {
            item_id: owned_item_ids[1].clone(),
        },
    );
    apply_rules_action(
        &store,
        &player_character_id,
        6,
        "buy-lamp-oil",
        RulesAuthority::LocalRule,
        RulesAction::ChangeMoney { delta: -3 },
    );
    apply_rules_action(
        &store,
        &player_character_id,
        7,
        "cross-midnight",
        RulesAuthority::LocalRule,
        RulesAction::AdvanceTime { minutes: 720 },
    );
    let rules_state = store
        .character_rules_state(&player_character_id)
        .expect("rules state after equipment economy and time actions");
    assert_eq!(
        rules_state.equipped_item_ids,
        vec![owned_item_ids[1].clone()]
    );
    assert_eq!(rules_state.money, 12);
    assert_eq!(rules_state.game_time_minutes, 765);

    let initial_location = store
        .dynamic_location_snapshot(CAMPAIGN_ID)
        .expect("initial location graph");
    let origin_location_id = initial_location.state.current_location_id.clone();
    let location_generation = store
        .dynamic_location_generation_snapshot(DynamicLocationGenerationRequest {
            campaign_id: CAMPAIGN_ID.to_owned(),
            origin_location_id: origin_location_id.clone(),
            expansion_mode: "CONNECTED".to_owned(),
            requested_count: 1,
        })
        .expect("prepare old salt gate");
    let location_output = json!({
        "schemaVersion": 1,
        "locations": [{
            "id": "fantasy-old-salt-gate",
            "name": "旧盐门",
            "kind": "RUIN",
            "parentLocationId": null,
            "description": "A drowned gatehouse beyond the harbor wall.",
            "atmosphere": "Cold tidewater moves beneath broken bells.",
            "features": ["A collapsed bell tower", "A sealed guild door"],
            "factionIds": [],
            "connections": [origin_location_id],
            "currentSituation": "The falling tide exposes a route for less than an hour.",
            "constitutionEvidence": location_generation.input["constitutionEvidence"],
        }]
    });
    let location_context = json!({
        "campaignId": CAMPAIGN_ID,
        "originLocationId": origin_location_id,
        "expansionMode": "CONNECTED",
        "requestedCount": 1,
    });
    store
        .commit_dynamic_location_generation(DynamicLocationGenerationCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            origin_location_id: origin_location_id.clone(),
            expansion_mode: "CONNECTED".to_owned(),
            requested_count: 1,
            generation: character_audit(
                "old-salt-gate",
                "GENERATE_LOCATIONS",
                location_generation.input,
                location_context,
                location_output,
            ),
        })
        .expect("commit old salt gate");
    let away = store
        .travel_dynamic_location(DynamicLocationTravelCommand {
            campaign_id: CAMPAIGN_ID.to_owned(),
            target_location_id: "fantasy-old-salt-gate".to_owned(),
            expected_revision: 1,
            mode: "ROAD".to_owned(),
            event_id: "fantasy-travel-salt-gate".to_owned(),
            operation_id: "fantasy-travel-op-salt-gate".to_owned(),
        })
        .expect("travel to old salt gate");
    assert_eq!(away.state.current_location_id, "fantasy-old-salt-gate");

    let first_dialogue = store
        .npc_dialogue_snapshot(CAMPAIGN_ID, &owner_id)
        .expect("initial dialogue");
    let replied = store
        .commit_npc_dialogue(dialogue_command(
            &first_dialogue,
            &owner_id,
            1,
            "Show me the cellar.",
        ))
        .expect("commit first dialogue");
    assert_eq!(replied.messages.len(), 2);

    let board = store
        .quest_board_snapshot(CAMPAIGN_ID)
        .expect("quest board");
    let publisher = board
        .source
        .available_npcs
        .iter()
        .find(|npc| npc.id == owner_id)
        .expect("quest publisher");
    let quest_output = json!({
        "content": {
            "title":"找回失火的潮汐账册",
            "summary":"取得烧焦账册并确认封蜡来源。",
            "objective":"在灰潮封门前把账册带回断梁酒馆。",
            "failureCost":"港务议会将关闭旧盐门。"
        },
        "risk":"MODERATE",
        "recommendedAttributes":["knowledge","agility"],
        "expectedTurns":{"min":8,"max":12},
        "rewardTier":"NOTABLE",
        "relatedNpcIds":[],
        "relatedFactIds":[]
    });
    let generated_board = store
        .commit_quest_generation(QuestGenerationCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            publisher_npc_id: owner_id.clone(),
            generation: audit(
                "quest",
                "GENERATE_QUEST",
                json!({
                    "world": board.source.world,
                    "tavernName": board.source.tavern_name,
                    "publisher": publisher,
                    "availableNpcs": board.source.available_npcs,
                    "playerConcept": board.source.player_concept,
                    "recentQuestTitles": board.source.recent_quest_titles,
                    "recentQuestStructures": board.source.recent_quest_structures,
                }),
                json!({
                    "tavernId": board.source.tavern_id,
                    "playerCharacterId": board.source.player_character_id,
                    "publisherNpcId": owner_id,
                }),
                quest_output,
            ),
        })
        .expect("generate quest");
    let quest_id = generated_board.quests[0].id.clone();
    store
        .accept_quest(CAMPAIGN_ID, &quest_id)
        .expect("accept quest");

    let branch_board = store
        .quest_board_snapshot(CAMPAIGN_ID)
        .expect("branch quest board");
    let branch_publisher = branch_board
        .source
        .available_npcs
        .iter()
        .find(|npc| npc.id == owner_id)
        .expect("branch quest publisher");
    let branch_output = json!({
        "content": {
            "title":"钟塔下的无名誓约",
            "summary":"追查藏在断裂钟塔下的烧焦誓文。",
            "objective":"查明谁抹去了旧誓并保护仍活着的见证人。",
            "failureCost":"巡钟团内部关系恶化。"
        },
        "risk":"HIGH",
        "recommendedAttributes":["charisma","knowledge"],
        "expectedTurns":{"min":8,"max":10},
        "rewardTier":"RARE",
        "relatedNpcIds":[],
        "relatedFactIds":[]
    });
    let branch_generated = store
        .commit_quest_generation(QuestGenerationCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            publisher_npc_id: owner_id.clone(),
            generation: audit(
                "quest-branch",
                "GENERATE_QUEST",
                json!({
                    "world": branch_board.source.world,
                    "tavernName": branch_board.source.tavern_name,
                    "publisher": branch_publisher,
                    "availableNpcs": branch_board.source.available_npcs,
                    "playerConcept": branch_board.source.player_concept,
                    "recentQuestTitles": branch_board.source.recent_quest_titles,
                    "recentQuestStructures": branch_board.source.recent_quest_structures,
                }),
                json!({
                    "tavernId": branch_board.source.tavern_id,
                    "playerCharacterId": branch_board.source.player_character_id,
                    "publisherNpcId": owner_id,
                }),
                branch_output,
            ),
        })
        .expect("generate branch quest");
    let branch_quest_id = branch_generated
        .quests
        .iter()
        .find(|quest| quest.content.title == "钟塔下的无名誓约")
        .expect("generated branch quest")
        .id
        .clone();
    store
        .accept_quest(CAMPAIGN_ID, &branch_quest_id)
        .expect("accept branch quest");

    let initial_adventure = store
        .adventure_snapshot(CAMPAIGN_ID, Some(&quest_id))
        .expect("adventure preparation");
    let planned = store
        .commit_adventure_plan(AdventurePlanCommit {
            campaign_id: CAMPAIGN_ID.to_owned(),
            quest_id: quest_id.clone(),
            generation: audit(
                "plan",
                "GENERATE_ADVENTURE_PLAN",
                initial_adventure.plan_input,
                json!({
                    "questId": quest_id,
                "playerCharacterId": player_character_id,
                }),
                adventure_plan_output(),
            ),
        })
        .expect("plan adventure");
    let adventure_id = planned.adventure_id.expect("adventure id");
    store
        .start_adventure(CAMPAIGN_ID, &adventure_id)
        .expect("start adventure");
    let mut ending = None;
    for turn_number in 1..=8 {
        let pending = store
            .submit_adventure_action(AdventureActionSubmit {
                campaign_id: CAMPAIGN_ID.to_owned(),
                adventure_id: adventure_id.clone(),
                action_mode: "ACTION".to_owned(),
                player_action: format!("Take release action {turn_number}"),
            })
            .expect("submit adventure action");
        let turn_id = pending
            .turns
            .last()
            .and_then(|turn| turn.get("id"))
            .and_then(Value::as_str)
            .expect("turn id")
            .to_owned();
        let is_ending = turn_number == 8;
        let committed = store
            .commit_adventure_turn(AdventureTurnCommit {
                campaign_id: CAMPAIGN_ID.to_owned(),
                adventure_id: adventure_id.clone(),
                generation: audit(
                    &format!("turn-{turn_number}"),
                    "GENERATE_ADVENTURE_TURN",
                    pending.turn_generation_context.expect("turn context"),
                    json!({"adventureId": adventure_id, "turnId": turn_id}),
                    adventure_turn_output(is_ending),
                ),
            })
            .expect("commit adventure turn");
        if is_ending {
            ending = Some(committed);
        } else {
            let rolled = store
                .roll_adventure_check(CAMPAIGN_ID, &adventure_id)
                .expect("roll local D20");
            store
                .commit_adventure_dice(AdventureDiceCommit {
                    campaign_id: CAMPAIGN_ID.to_owned(),
                    adventure_id: adventure_id.clone(),
                    generation: audit(
                        &format!("dice-{turn_number}"),
                        "RESOLVE_DICE_RESULT",
                        rolled.dice_generation_input.expect("dice input"),
                        json!({"adventureId": adventure_id, "turnId": turn_id}),
                        json!({
                            "narration":"The hidden catch yields.",
                            "consequence":"The path ahead opens.",
                            "statePatchProposals":[]
                        }),
                    ),
                })
                .expect("commit D20 result");
        }
    }
    let ending = ending.expect("ending snapshot");
    assert_eq!(ending.state.as_deref(), Some("ENDING"));
    assert_eq!(ending.current_turn_number, 8);

    let returned = store
        .travel_dynamic_location(DynamicLocationTravelCommand {
            campaign_id: CAMPAIGN_ID.to_owned(),
            target_location_id: origin_location_id,
            expected_revision: 2,
            mode: "ROAD".to_owned(),
            event_id: "fantasy-travel-return".to_owned(),
            operation_id: "fantasy-travel-op-return".to_owned(),
        })
        .expect("return to the harbor");
    assert_eq!(returned.travel_history.len(), 2);

    let clock_id = store
        .tavern_snapshot(CAMPAIGN_ID)
        .expect("settlement clock")
        .clocks[0]
        .id
        .clone();
    let settlement = store
        .commit_adventure_settlement(settlement_command(
            &adventure_id,
            &quest_id,
            &owner_id,
            &clock_id,
        ))
        .expect("settle adventure");
    assert_eq!(settlement.outcome, "SUCCESS");
    assert_eq!(store.list().expect("campaign list")[0].state, "TAVERN");

    let director_preparation = store
        .prepare_world_director(WorldDirectorPrepareCommand {
            campaign_id: CAMPAIGN_ID.to_owned(),
        })
        .expect("prepare world director observation");
    let director_run = store
        .commit_world_director(WorldDirectorCommitCommand {
            id: "fantasy-director-run-after-settlement".to_owned(),
            campaign_id: CAMPAIGN_ID.to_owned(),
            trigger: WorldDirectorTrigger {
                kind: "MANUAL".to_owned(),
                id: "fantasy-director-manual-after-settlement".to_owned(),
            },
            expected_context_digest: director_preparation.context_digest,
            occurred_at: "2026-08-01T14:20:00.000Z".to_owned(),
        })
        .expect("commit world director observation");
    assert!(director_run.pressure_score <= 99);

    let first_models = store
        .save_model_settings(model_update(
            "ollama",
            "Local primary",
            None,
            "ember-local",
            true,
            true,
        ))
        .expect("save initial model");
    let first_profile_id = first_models
        .default_model_profile_id
        .expect("initial default model");
    let switched_models = store
        .save_model_settings(model_update(
            "custom",
            "Loopback fallback",
            Some("http://127.0.0.1:11434/v1/".to_owned()),
            "ember-loopback",
            true,
            false,
        ))
        .expect("switch model");
    assert_ne!(
        switched_models.default_model_profile_id.as_deref(),
        Some(first_profile_id.as_str())
    );
    assert_eq!(
        switched_models.fallback_model_profile_id.as_deref(),
        Some(first_profile_id.as_str())
    );

    let resumed_dialogue = store
        .npc_dialogue_snapshot(CAMPAIGN_ID, &owner_id)
        .expect("dialogue after model switch");
    let after_switch = store
        .commit_npc_dialogue(dialogue_command(
            &resumed_dialogue,
            &owner_id,
            2,
            "What changed after the beacon?",
        ))
        .expect("continue dialogue after switch");
    assert_eq!(after_switch.messages.len(), 4);
    drop(store);

    let reopened = CampaignStore::open(&database_path).expect("restart release candidate");
    assert_eq!(
        reopened.list().expect("restarted campaign list")[0].state,
        "TAVERN"
    );
    assert_eq!(
        reopened
            .npc_dialogue_snapshot(CAMPAIGN_ID, &owner_id)
            .expect("restore dialogue after restart")
            .messages
            .len(),
        4
    );
    reopened
        .connect()
        .expect("connect for interrupted request")
        .execute_batch(
            "UPDATE campaigns
               SET state = 'RECOVERY_REQUIRED', resume_state = 'TAVERN'
               WHERE id = 'playtest-m11-fantasy';
             INSERT INTO pending_ai_requests (
               id, campaign_id, turn_id, idempotency_key, task, status, model_profile_id,
               input_json, context_json, attempt_count, last_error_json, created_at, updated_at
             ) VALUES (
               'e2e-interrupted-request', 'playtest-m11-fantasy', NULL,
               'e2e:interrupted-request', 'NPC_REPLY', 'SENDING', NULL,
               '{}', '{}', 1, NULL,
               '2026-08-01T14:30:00.000Z', '2026-08-01T14:30:00.000Z'
             );",
        )
        .expect("persist interrupted request before crash");
    drop(reopened);

    let recovered = CampaignStore::open(&database_path).expect("restart after interrupted request");
    let recovery = recovered
        .campaign_recovery(CAMPAIGN_ID)
        .expect("inspect interrupted request");
    assert_eq!(recovery.resume_state, "TAVERN");
    assert_eq!(recovery.unfinished_request_count, 1);
    assert_eq!(
        recovered
            .restore_campaign_after_failure(CAMPAIGN_ID)
            .expect("restore last committed state")
            .state,
        "TAVERN"
    );
    assert_eq!(
        recovered
            .connect()
            .expect("verify cancelled request")
            .query_row(
                "SELECT status FROM pending_ai_requests WHERE id = 'e2e-interrupted-request'",
                [],
                |row| row.get::<_, String>(0),
            )
            .expect("interrupted request status"),
        "CANCELLED"
    );
    assert_eq!(
        recovered
            .continue_campaign(CAMPAIGN_ID)
            .expect("continue after recovery")
            .state,
        "TAVERN"
    );

    recovered
        .export_campaign_archive(CAMPAIGN_ID, &archive_path, "0.1.0")
        .expect("export save archive");
    assert_eq!(
        recovered
            .inspect_campaign_archive(&archive_path)
            .expect("inspect exported archive")
            .campaign_id,
        CAMPAIGN_ID
    );
    recovered
        .import_campaign_archive(&archive_path, CampaignArchiveImportMode::Overwrite)
        .expect("restore campaign from portable archive");
    drop(recovered);

    let imported = CampaignStore::open(&database_path).expect("restart imported campaign");
    assert_eq!(
        imported
            .continue_campaign(CAMPAIGN_ID)
            .expect("continue imported campaign")
            .state,
        "TAVERN"
    );
    assert_eq!(
        imported
            .list_adventure_archives(CAMPAIGN_ID)
            .expect("restore adventure archive")
            .len(),
        1
    );
    let imported_dialogue = imported
        .npc_dialogue_snapshot(CAMPAIGN_ID, &owner_id)
        .expect("restore imported dialogue");
    let continued = imported
        .commit_npc_dialogue(dialogue_command(
            &imported_dialogue,
            &owner_id,
            3,
            "Tell me where the road leads next.",
        ))
        .expect("continue imported game");
    assert_eq!(continued.messages.len(), 6);
    assert_eq!(
        imported
            .model_settings()
            .expect("preserved device settings")
            .profiles
            .len(),
        2
    );
}

fn world_draft() -> WorldDraft {
    WorldDraft {
        constitution: WorldConstitutionDraft {
            schema_version: 1,
            world_type: "低魔黑暗奇幻港邦".to_owned(),
            era: "行会与封建领主并存的晚期中世纪".to_owned(),
            technology: "水车、帆船、锻钢与稀有炼金术".to_owned(),
            magic: "魔法依赖契约、材料与代价，不能凭空改写既成事实".to_owned(),
            peoples: vec![
                "沿岸人类".to_owned(),
                "盐沼矮裔".to_owned(),
                "迁徙林民".to_owned(),
            ],
            society: "行会、领主与神殿共享脆弱秩序".to_owned(),
            politics: "港务议会与巡钟团争夺潮汐税和夜间通行权".to_owned(),
            economy: "银币、货契和实物债务并行，普通物资价格稳定".to_owned(),
            combat_scale: "个人与小队冲突，伤势和补给持续生效".to_owned(),
            death_rules: "死亡永久；濒死必须由明确规则和资源处理".to_owned(),
            career_rules: "职业来自行会、神殿、领主或边地生计，并带社会义务".to_owned(),
            equipment_rules: "钢铁、皮革、炼金消耗品和有代价的符文器具".to_owned(),
            npc_rules: "NPC 只知道亲历、被告知或合理推断的事实，并保有私人目标".to_owned(),
            trait_rules: "超常优势必须绑定可触发的代价或限制".to_owned(),
            taboos: vec![
                "无代价复活".to_owned(),
                "无限资源".to_owned(),
                "现代火器".to_owned(),
            ],
        },
        name: "灰烬潮下的烛湾".to_owned(),
        current_region: "烛湾".to_owned(),
        summary: "灰潮、行会旧约与夜钟共同维系的低魔港邦。".to_owned(),
        core_conflict: "巡钟团与港务议会争夺旧盐门和失火潮汐账册。".to_owned(),
        technology_level: "水车、帆船、锻钢与稀有炼金术".to_owned(),
        power_rules: vec!["魔法依赖契约、材料与代价，不能凭空改写既成事实".to_owned()],
        factions: vec![FactionDraft {
            name: "巡钟团".to_owned(),
            description: "维持潮门夜钟与东门通行秩序。".to_owned(),
            goals: vec!["找回潮汐账册并保住夜间通行权。".to_owned()],
        }],
        locations: vec![LocationDraft {
            name: "烛湾".to_owned(),
            description: "建在潮门与断裂钟塔阴影下的港城。".to_owned(),
            parent_name: None,
            faction_names: vec!["巡钟团".to_owned()],
        }],
        narrative_style: "克制、可追溯后果的黑暗奇幻调查。".to_owned(),
        forbidden_elements: vec![
            "无代价复活".to_owned(),
            "无限资源".to_owned(),
            "现代火器".to_owned(),
        ],
        tavern_reason: "旅人、巡钟人和行会商人在退潮前交换消息。".to_owned(),
        story_hooks: vec!["第三声钟后灰潮倒流，失火账册再次出现。".to_owned()],
    }
}

fn fantasy_career_pool_command(store: &CampaignStore) -> CareerPoolGenerationCommit {
    let constitution = world_draft().constitution;
    let revision = store
        .connect()
        .expect("query locked constitution revision")
        .query_row(
            "SELECT revision FROM world_constitutions WHERE campaign_id=?1 AND status='LOCKED'",
            [CAMPAIGN_ID],
            |row| row.get::<_, i64>(0),
        )
        .expect("locked constitution revision");
    let constitution_value = json!({
        "schemaVersion": constitution.schema_version,
        "worldType": constitution.world_type,
        "era": constitution.era,
        "technology": constitution.technology,
        "magic": constitution.magic,
        "peoples": constitution.peoples,
        "society": constitution.society,
        "politics": constitution.politics,
        "economy": constitution.economy,
        "combatScale": constitution.combat_scale,
        "deathRules": constitution.death_rules,
        "careerRules": constitution.career_rules,
        "equipmentRules": constitution.equipment_rules,
        "npcRules": constitution.npc_rules,
        "traitRules": constitution.trait_rules,
        "taboos": constitution.taboos,
    });
    let evidence = json!({
        "careerRules": constitution_value["careerRules"],
        "society": constitution_value["society"],
        "technology": constitution_value["technology"],
        "economy": constitution_value["economy"],
    });
    let career = |id: &str, name: &str, rarity: &str, archetype: &str, role: &str| {
        json!({
            "id": id,
            "name": name,
            "rarity": rarity,
            "role": role,
            "skills": ["Contract lore", "Tide reading"],
            "equipmentTags": ["Guild papers", "Weather lamp"],
            "socialPosition": "Licensed worker owing service to a harbor institution.",
            "relationshipHooks": ["Answers to a guild patron"],
            "risks": ["Old obligations can be called due"],
            "requirements": ["Recognized apprenticeship"],
            "constitutionEvidence": evidence,
            "legacyArchetype": archetype,
        })
    };
    let output = json!({
        "schemaVersion": 1,
        "careers": [
            career("ash-watch", "灰烬守夜人", "COMMON", "WARRIOR", "巡守潮门与夜钟。"),
            career("mist-scrivener", "雾钟抄契人", "UNCOMMON", "SCHOLAR", "抄录并仲裁港邦契约。"),
            career("marsh-guide", "盐沼引路者", "RARE", "ROGUE", "带队穿越潮沼与旧堤。"),
        ]
    });
    let input = json!({
        "schemaVersion": 1,
        "context": {
            "worldId": CAMPAIGN_ID,
            "constitutionRevision": revision,
            "contextSummary": constitution_value.to_string(),
        },
        "generationMode": "INITIAL",
        "requestedCount": 3,
        "requestedRarities": ["COMMON", "UNCOMMON", "RARE"],
        "existingCareerIds": [],
        "existingCareerNames": [],
    });
    CareerPoolGenerationCommit {
        campaign_id: CAMPAIGN_ID.to_owned(),
        expected_revision: 0,
        generation: character_audit(
            "career-pool",
            "GENERATE_CAREER_POOL",
            input,
            json!({
                "campaignId": CAMPAIGN_ID,
                "constitutionRevision": revision,
                "expectedPoolRevision": 0,
            }),
            output,
        ),
    }
}

fn character_draft() -> CharacterDraftInput {
    CharacterDraftInput {
        id: "fantasy-character-scrivener".to_owned(),
        campaign_id: CAMPAIGN_ID.to_owned(),
        name: "伊岚".to_owned(),
        gender: None,
        age: Some(27),
        concept: "背负旧誓的雾钟抄契人".to_owned(),
        story_preferences: vec!["契约谜团".to_owned(), "行会冲突".to_owned()],
        content_boundaries: CharacterContentBoundaries {
            allow_horror: false,
            allow_permanent_death: false,
            allow_romance: true,
            allow_betrayal: true,
            excluded_content: Vec::new(),
        },
        class_archetype: "SCHOLAR".to_owned(),
        class_display_name: "雾钟抄契人".to_owned(),
        attributes: CharacterAttributes {
            physique: 2,
            agility: 4,
            knowledge: 3,
            charisma: 1,
        },
        personal_goal: "查清家族旧誓为何从潮门账簿中被抹去。".to_owned(),
    }
}

fn character_audit(
    suffix: &str,
    task: &str,
    input: Value,
    context: Value,
    output: Value,
) -> CharacterGenerationAudit {
    CharacterGenerationAudit {
        request_id: format!("e2e-character-request-{suffix}"),
        generation_record_id: format!("e2e-character-generation-{suffix}"),
        idempotency_key: format!("e2e:character:{suffix}"),
        prompt_version: match task {
            "GENERATE_NPCS" => 4,
            "NPC_REPLY" => 3,
            "GENERATE_QUEST" => 2,
            _ => 1,
        },
        input,
        context,
        request: json!({"task":task}),
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
        request_id: format!("e2e-request-{suffix}"),
        generation_record_id: format!("e2e-generation-{suffix}"),
        idempotency_key: format!("e2e:{suffix}"),
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

fn npc_output(name: &str) -> Value {
    json!({
        "name":name,
        "identity":format!("Role of {name}"),
        "appearance":format!("{name} wears weathered clothes."),
        "personality":format!("Temperament of {name}"),
        "goal":format!("{name} wants to keep a road open."),
        "secret":format!("{name} knows a different hidden route."),
        "speechStyle":format!("{name} asks measured questions."),
        "currentMood":"Concerned"
    })
}

fn roster_npc(residency: &str, name: &str, visit_reason: Value) -> Value {
    let mut npc = npc_output(name);
    npc["residency"] = json!(residency);
    npc["visitReason"] = visit_reason;
    npc
}

fn dialogue_command(
    snapshot: &NpcDialogueSnapshot,
    npc_id: &str,
    index: usize,
    player_message: &str,
) -> NpcDialogueCommit {
    let reply = match index {
        1 => "Stay close and touch nothing warm.",
        2 => "The lower stones have cooled, so the passage can be approached carefully.",
        _ => "Beyond the harbor road, fresh wagon tracks turn toward the northern ridge.",
    };
    let output = json!({
        "reply":reply,
        "mood":"Wary",
        "suggestedTopics":["The old tunnel"],
        "memoryCandidate":null,
        "relationshipProposal":{"trust":1}
    });
    let mut input = snapshot.generation_context.clone();
    input
        .as_object_mut()
        .expect("dialogue context object")
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

fn adventure_plan_output() -> Value {
    json!({
        "objective":"Restore the beacon.",
        "risk":"MODERATE",
        "expectedTurns":{"min":8,"max":12},
        "coreScenes":["Open the cellar.","Cross the causeway.","Reach the beacon."],
        "necessaryClues":[
            {"title":"Scorched Lens","description":"Burned from inside.","isCore":true},
            {"title":"Tide Ledger","description":"A deliberate schedule.","isCore":true},
            {"title":"Keeper Signet","description":"The keeper sealed it.","isCore":true}
        ],
        "majorObstacles":["A rusted lock."],
        "possibleEndings":["The beacon is restored.","The harbor evacuates."],
        "failureCost":"Ships remain trapped."
    })
}

fn adventure_turn_output(ending: bool) -> Value {
    if ending {
        json!({
            "sceneText":"The beacon catches as the storm breaks.",
            "speakerNpcIds":[],
            "suggestedActions":[],
            "checkRequest":null,
            "discoveredClues":[],
            "statePatchProposals":[],
            "adventureState":"ENDING"
        })
    } else {
        json!({
            "sceneText":"Warm light leaks through the old cellar lock.",
            "speakerNpcIds":[],
            "suggestedActions":[
                {"text":"Study the lock."},
                {"text":"Ask the keeper about the old key."},
                {"text":"Observe the warm marks on the frame."}
            ],
            "checkRequest":{
                "attribute":"knowledge",
                "difficulty":11,
                "reason":"Identify the hidden mechanism."
            },
            "discoveredClues":["Scorched Lens"],
            "statePatchProposals":[],
            "adventureState":"CHECK_REQUIRED"
        })
    }
}

fn settlement_command(
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
                "summary":"The beacon burns.",
                "keyDecisions":["Stayed through the storm."],
                "unresolvedThreads":[],
                "nextDirections":["Follow the reopened road."],
                "npcUpdates":[{
                    "npcId":publisher_id,
                    "currentMood":"Relieved",
                    "relationshipPatch":{"trust":1}
                }],
                "tavernChange":{"kind":"TROPHY","description":"A lens hangs above the hearth."},
                "statePatchProposals":[
                    {"kind":"QUEST","targetId":quest_id,"rationale":"Done","payload":{"status":"COMPLETED"}},
                    {"kind":"RELATIONSHIP","targetId":publisher_id,"rationale":"Trusted","payload":{"trust":1}},
                    {"kind":"ITEM_REWARD","targetId":null,"rationale":"Reward","payload":{"questId":quest_id,"name":"Compass","description":"Stormglass","rewardTier":"NOTABLE"}}
                ]
            }),
        ),
        world_event: audit(
            "settlement-world",
            "GENERATE_WORLD_EVENT",
            json!({}),
            json!({"adventureId":adventure_id}),
            json!({
                "title":"Storm tide",
                "description":"The road reopens.",
                "newFacts":["The beacon burns again."],
                "clockAdvances":[{"clockId":clock_id,"amount":1,"reason":"The storm breaks."}]
            }),
        ),
        equipment: audit(
            "settlement-equipment",
            "GENERATE_ITEMS",
            json!({
                "schemaVersion":1,
                "context":{"worldId":CAMPAIGN_ID,"constitutionRevision":2,"contextSummary":"Harbor"},
                "purpose":"Quest reward",
                "requestedCount":1,
                "requestedRarity":"NOTABLE",
                "source":{"kind":"QUEST_REWARD","questId":quest_id,"adventureId":adventure_id},
                "bindingTargets":[
                    {"kind":"QUEST","targetId":quest_id,"allowedTriggers":["QUEST_CONTEXT"],"summary":"Quest"},
                    {"kind":"NPC","targetId":publisher_id,"allowedTriggers":["NPC_RECOGNITION"],"summary":"Publisher"},
                    {"kind":"WORLD_FACT","targetId":format!("settlement-fact:{adventure_id}:0"),"allowedTriggers":["FACT_EVIDENCE"],"summary":"Fact"}
                ],
                "constitutionEvidence":{"equipmentRules":"钢铁、皮革、炼金消耗品和有代价的符文器具","technology":"水车、帆船、锻钢与稀有炼金术","economy":"银币、货契和实物债务并行，普通物资价格稳定"},
                "existingItemIds":[],"existingItemNames":[]
            }),
            json!({"adventureId":adventure_id}),
            json!({"schemaVersion":1,"items":[{
                "id":format!("reward-semantic-{adventure_id}"),
                "name":"Stormglass Compass","description":"A grounded route-finding relic.","category":"TOOL",
                "appearance":"Clouded blue glass in dark brass.","history":"Carried by a route warden.","origin":"The lantern guild.",
                "narrativeAbilities":["Reveals faded route marks"],"semanticEffects":["Recognized by wardens"],"balanceTags":["NON_COMBAT"],
                "bindings":[
                    {"kind":"QUEST","targetId":quest_id,"trigger":"QUEST_CONTEXT","summary":"Recovered during this quest."},
                    {"kind":"NPC","targetId":publisher_id,"trigger":"NPC_RECOGNITION","summary":"The publisher recognizes it."},
                    {"kind":"WORLD_FACT","targetId":format!("settlement-fact:{adventure_id}:0"),"trigger":"FACT_EVIDENCE","summary":"It records the restored beacon."}
                ],
                "constitutionEvidence":{"equipmentRules":"钢铁、皮革、炼金消耗品和有代价的符文器具","technology":"水车、帆船、锻钢与稀有炼金术","economy":"银币、货契和实物债务并行，普通物资价格稳定"}
            }]}),
        ),
    }
}

fn apply_rules_action(
    store: &CampaignStore,
    player_character_id: &str,
    expected_revision: i64,
    suffix: &str,
    authority: RulesAuthority,
    action: RulesAction,
) {
    store
        .apply_rules_command(RulesApplyCommand {
            event_id: format!("fantasy-rules-event-{suffix}"),
            idempotency_key: format!("fantasy-rules:{suffix}"),
            expected_revision,
            occurred_at: format!("2026-08-01T14:{expected_revision:02}:00.000Z"),
            command: RulesCommand {
                campaign_id: CAMPAIGN_ID.to_owned(),
                player_character_id: player_character_id.to_owned(),
                authority,
                action,
            },
        })
        .expect("apply fantasy playtest rules action");
}

fn model_update(
    preset_key: &str,
    display_name: &str,
    base_url: Option<String>,
    model_name: &str,
    use_as_default: bool,
    use_as_fallback: bool,
) -> ModelSettingsUpdate {
    let normalized_base_url = base_url.unwrap_or_else(|| "http://localhost:11434/v1/".to_owned());
    let capabilities = ModelCapabilitiesRegistration {
        text: true,
        streaming: false,
        system_messages: true,
        json_mode: true,
        json_schema: false,
        tool_calling: false,
        reasoning: false,
        context_window_tokens: Some(32_768),
        cost_status: "UNKNOWN".to_owned(),
        checked_at: "2026-08-01T14:00:00Z".to_owned(),
    };
    let endpoint_fingerprint = model_endpoint_fingerprint(preset_key, &normalized_base_url);
    let capability_source = CapabilitySource::Unknown;
    let probe_fingerprint = model_probe_fingerprint(
        &endpoint_fingerprint,
        model_name,
        capability_source,
        &capabilities,
    )
    .unwrap();
    ModelSettingsUpdate {
        preset_key: preset_key.to_owned(),
        provider_display_name: display_name.to_owned(),
        base_url: Some(normalized_base_url),
        endpoint_fingerprint,
        credential_ref: None,
        credential_action: CredentialAction::Keep,
        model_name: model_name.to_owned(),
        model_display_name: model_name.to_owned(),
        capabilities,
        capability_source,
        probe_fingerprint,
        probe_receipt_id: Uuid::new_v4().to_string(),
        use_as_default,
        use_as_fallback,
    }
}
