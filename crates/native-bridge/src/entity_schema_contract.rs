use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum EntityKind {
    WorldConstitution,
    Career,
    Trait,
    Item,
    Location,
    Faction,
    NpcLod,
    QuestGraph,
    DirectorAction,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EntityFixture {
    kind: EntityKind,
    input: Value,
    output: Value,
}

const FIXTURES: &str =
    include_str!("../../../packages/ai-core/src/entity-schema-contract.fixture.json");

fn version(value: &Value) -> Option<u64> {
    value.as_object()?.get("schemaVersion")?.as_u64()
}

fn array_len(value: &Value, field: &str) -> Option<usize> {
    value.as_object()?.get(field)?.as_array().map(Vec::len)
}

fn required_output_field(kind: EntityKind) -> &'static str {
    match kind {
        EntityKind::WorldConstitution => "worldType",
        EntityKind::Career => "careers",
        EntityKind::Trait => "traits",
        EntityKind::Item => "items",
        EntityKind::Location => "locations",
        EntityKind::Faction => "factions",
        EntityKind::NpcLod => "npc",
        EntityKind::QuestGraph => "quests",
        EntityKind::DirectorAction => "actions",
    }
}

fn output_resource_limit(kind: EntityKind) -> Option<(&'static str, usize)> {
    match kind {
        EntityKind::Career => Some(("careers", 24)),
        EntityKind::Trait => Some(("traits", 12)),
        EntityKind::Item => Some(("items", 24)),
        EntityKind::Location => Some(("locations", 32)),
        EntityKind::Faction => Some(("factions", 16)),
        EntityKind::QuestGraph => Some(("quests", 24)),
        EntityKind::DirectorAction => Some(("actions", 32)),
        EntityKind::WorldConstitution | EntityKind::NpcLod => None,
    }
}

fn validate_boundary(fixture: &EntityFixture) -> Result<(), &'static str> {
    if version(&fixture.input) != Some(1) || version(&fixture.output) != Some(1) {
        return Err("unsupported entity schema version");
    }
    let output = fixture
        .output
        .as_object()
        .ok_or("output must be an object")?;
    if !output.contains_key(required_output_field(fixture.kind)) {
        return Err("required entity output field is missing");
    }
    if let Some((field, limit)) = output_resource_limit(fixture.kind)
        && array_len(&fixture.output, field).ok_or("resource field must be an array")? > limit
    {
        return Err("entity resource limit exceeded");
    }
    if fixture.kind == EntityKind::QuestGraph
        && array_len(&fixture.output, "edges").ok_or("resource field must be an array")? > 96
    {
        return Err("entity resource limit exceeded");
    }
    Ok(())
}

#[test]
fn typescript_and_rust_share_entity_kinds_versions_and_resource_boundaries() {
    let fixtures: Vec<EntityFixture> = serde_json::from_str(FIXTURES).unwrap();
    assert_eq!(fixtures.len(), 9);
    assert_eq!(
        fixtures
            .iter()
            .map(|fixture| fixture.kind)
            .collect::<Vec<_>>(),
        vec![
            EntityKind::WorldConstitution,
            EntityKind::Career,
            EntityKind::Trait,
            EntityKind::Item,
            EntityKind::Location,
            EntityKind::Faction,
            EntityKind::NpcLod,
            EntityKind::QuestGraph,
            EntityKind::DirectorAction,
        ]
    );
    for fixture in &fixtures {
        validate_boundary(fixture).unwrap();
    }
}

#[test]
fn rust_boundary_rejects_unknown_versions_missing_fields_and_resource_overflow() {
    let mut fixtures: Vec<EntityFixture> = serde_json::from_str(FIXTURES).unwrap();
    fixtures[0].input["schemaVersion"] = Value::from(2);
    assert_eq!(
        validate_boundary(&fixtures[0]),
        Err("unsupported entity schema version")
    );

    fixtures[1]
        .output
        .as_object_mut()
        .unwrap()
        .remove("careers");
    assert_eq!(
        validate_boundary(&fixtures[1]),
        Err("required entity output field is missing")
    );

    let mut fixtures: Vec<EntityFixture> = serde_json::from_str(FIXTURES).unwrap();
    let career = fixtures[1].output["careers"][0].clone();
    fixtures[1].output["careers"] = Value::Array(vec![career; 25]);
    assert_eq!(
        validate_boundary(&fixtures[1]),
        Err("entity resource limit exceeded")
    );
}

#[test]
fn rust_fixture_envelope_rejects_unknown_data() {
    let mut value: Value = serde_json::from_str(FIXTURES).unwrap();
    value[0]["ignored"] = Value::Bool(true);
    assert!(serde_json::from_value::<Vec<EntityFixture>>(value).is_err());
}
