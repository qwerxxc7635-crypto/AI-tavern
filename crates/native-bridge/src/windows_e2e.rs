use serde_json::{Value, json};

use super::*;

const CAMPAIGN_ID: &str = "campaign-windows-e2e";

#[test]
fn completes_the_windows_release_vertical_slice_on_one_persistent_save() {
    let directory = tempfile::tempdir().expect("temporary release directory");
    let database_path = directory.path().join("ember-tavern.sqlite");
    let archive_path = directory.path().join("windows-release.emtavern");
    let store = CampaignStore::open(&database_path).expect("open release database");
    store
        .create_at(
            CAMPAIGN_ID.to_owned(),
            "2026-08-01T14:00:00.000Z".to_owned(),
        )
        .expect("create campaign");

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

    let character = character_draft();
    let trait_output = json!({
        "traits": [
            {"name":"Keen Listener","description":"Notices quiet changes."},
            {"name":"Roadwise","description":"Reads signs on the road."},
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
            {"name":"Trail Compass","description":"A weathered brass compass."},
            {"name":"Travel Cloak","description":"A waxed cloak."}
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
    let completed_character = store
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
        .expect("complete character");
    assert_eq!(completed_character.campaign_state, "GENERATING_TAVERN");

    let source = store
        .tavern_snapshot(CAMPAIGN_ID)
        .expect("tavern source")
        .source;
    let tavern_output = json!({
        "name":"Ember Rest",
        "position":"The harbor crossroads",
        "environment":"A warm stone hall filled with salt air.",
        "specialRules":["Weapons remain sheathed beside the common fire."],
        "longTermProblem":"A strange light appears beneath the cellar.",
        "owner": npc_output("Ilyra Venn"),
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
            roster_npc("RESIDENT", "Tomas Reed", Value::Null),
            roster_npc("RESIDENT", "Nessa Vale", Value::Null),
            roster_npc("TEMPORARY_VISITOR", "Sera Holt", json!("Waiting for the causeway."))
        ],
        "rumors": [
            {"statement":"A light moves below the cellar.","sourceNpcName":"Tomas Reed","veracity":"TRUE"},
            {"statement":"The guild pays for tunnel maps.","sourceNpcName":"Nessa Vale","veracity":"PARTIAL"},
            {"statement":"The courier crossed alone.","sourceNpcName":"Sera Holt","veracity":"UNKNOWN"}
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
            "title":"The Fading Beacon",
            "summary":"Investigate the failing lighthouse.",
            "objective":"Restore the beacon.",
            "failureCost":"Ships remain trapped."
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
                    "playerCharacterId": completed_character.character.expect("player").draft.id,
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

    let clock_id = store
        .tavern_snapshot(CAMPAIGN_ID)
        .expect("settlement clock")
        .clocks[0]
        .id
        .clone();
    let settlement = store
        .commit_adventure_settlement(settlement_command(&adventure_id, &owner_id, &clock_id))
        .expect("settle adventure");
    assert_eq!(settlement.outcome, "SUCCESS");
    assert_eq!(store.list().expect("campaign list")[0].state, "TAVERN");

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
        .export_campaign_archive(CAMPAIGN_ID, &archive_path, "0.1.0")
        .expect("export save archive");
    assert_eq!(
        reopened
            .inspect_campaign_archive(&archive_path)
            .expect("inspect exported archive")
            .campaign_id,
        CAMPAIGN_ID
    );
    reopened
        .connect()
        .expect("connect for local delete")
        .execute("DELETE FROM campaigns WHERE id = ?1", [CAMPAIGN_ID])
        .expect("delete local campaign");
    assert!(reopened.list().expect("empty campaign list").is_empty());
    reopened
        .import_campaign_archive(&archive_path, CampaignArchiveImportMode::Create)
        .expect("reimport campaign");
    drop(reopened);

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
        name: "Ember Coast".to_owned(),
        current_region: "Ash Harbor".to_owned(),
        summary: "A storm-bound coast.".to_owned(),
        core_conflict: "The beacon is fading.".to_owned(),
        technology_level: "Early industrial".to_owned(),
        power_rules: vec!["Weather magic has a cost.".to_owned()],
        factions: vec![FactionDraft {
            name: "Harbor Guild".to_owned(),
            description: "Keeps the sea roads open.".to_owned(),
            goals: vec!["Restore the beacon.".to_owned()],
        }],
        locations: vec![LocationDraft {
            name: "Ash Harbor".to_owned(),
            description: "A port beneath a dark lighthouse.".to_owned(),
            parent_name: None,
            faction_names: vec!["Harbor Guild".to_owned()],
        }],
        narrative_style: "Grounded mystery.".to_owned(),
        forbidden_elements: Vec::new(),
        tavern_reason: "Travelers wait out storms.".to_owned(),
        story_hooks: vec!["A light moves beneath the harbor.".to_owned()],
    }
}

fn character_draft() -> CharacterDraftInput {
    CharacterDraftInput {
        id: "character-windows-e2e".to_owned(),
        campaign_id: CAMPAIGN_ID.to_owned(),
        name: "Mira".to_owned(),
        gender: None,
        age: Some(27),
        concept: "Curious scout".to_owned(),
        story_preferences: vec!["Exploration".to_owned()],
        content_boundaries: CharacterContentBoundaries {
            allow_horror: false,
            allow_permanent_death: false,
            allow_romance: true,
            allow_betrayal: true,
            excluded_content: Vec::new(),
        },
        class_archetype: "ROGUE".to_owned(),
        class_display_name: "Wayfinder".to_owned(),
        attributes: CharacterAttributes {
            physique: 2,
            agility: 4,
            knowledge: 3,
            charisma: 1,
        },
        personal_goal: "Find a lost sibling.".to_owned(),
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
        prompt_version: 1,
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
        prompt_version: 1,
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
        "identity":"Traveler",
        "appearance":"Weathered clothes.",
        "personality":"Observant and practical.",
        "goal":"Keep the road open.",
        "secret":"Knows a hidden route.",
        "speechStyle":"Measured questions.",
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
    let output = json!({
        "reply":"Stay close and touch nothing warm.",
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
            "suggestedActions":[{"text":"Study the lock."}],
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
                    {"kind":"QUEST","targetId":"model-symbol","rationale":"Done","payload":{"status":"COMPLETED"}},
                    {"kind":"RELATIONSHIP","targetId":publisher_id,"rationale":"Trusted","payload":{"trust":1}},
                    {"kind":"ITEM_REWARD","targetId":null,"rationale":"Reward","payload":{"questId":"model-symbol","name":"Compass","description":"Stormglass","rewardTier":"NOTABLE"}}
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
    }
}

fn model_update(
    preset_key: &str,
    display_name: &str,
    base_url: Option<String>,
    model_name: &str,
    use_as_default: bool,
    use_as_fallback: bool,
) -> ModelSettingsUpdate {
    ModelSettingsUpdate {
        preset_key: preset_key.to_owned(),
        provider_display_name: display_name.to_owned(),
        base_url,
        credential_ref: None,
        credential_action: CredentialAction::Keep,
        model_name: model_name.to_owned(),
        model_display_name: model_name.to_owned(),
        capabilities: ModelCapabilitiesRegistration {
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
        },
        use_as_default,
        use_as_fallback,
    }
}
