use std::collections::HashSet;

pub(crate) fn find_repeated_phrase<'a>(
    values: impl IntoIterator<Item = &'a str>,
) -> Option<String> {
    find_repeated_phrase_against(values, std::iter::empty())
}

pub(crate) fn find_repeated_phrase_against<'a, 'b>(
    values: impl IntoIterator<Item = &'a str>,
    existing_values: impl IntoIterator<Item = &'b str>,
) -> Option<String> {
    let mut seen = HashSet::new();
    for value in existing_values {
        for segment in value.split(['.', '!', '?', '。', '！', '？', '；', ';', '\n']) {
            let normalized = normalize_text(segment);
            if normalized
                .chars()
                .filter(|character| character.is_alphanumeric())
                .count()
                >= 12
            {
                seen.insert(normalized);
            }
        }
    }
    for value in values {
        for segment in value.split(['.', '!', '?', '。', '！', '？', '；', ';', '\n']) {
            let normalized = normalize_text(segment);
            if normalized
                .chars()
                .filter(|character| character.is_alphanumeric())
                .count()
                < 12
            {
                continue;
            }
            if !seen.insert(normalized.clone()) {
                return Some(normalized);
            }
        }
    }
    None
}

pub(crate) fn quest_structure_signature(
    risk: &str,
    reward_tier: &str,
    minimum_turns: i64,
    maximum_turns: i64,
    recommended_attributes: &[String],
) -> String {
    let mut attributes = recommended_attributes
        .iter()
        .map(|value| value.trim().to_lowercase())
        .collect::<Vec<_>>();
    attributes.sort();
    format!(
        "{}|{}|{minimum_turns}-{maximum_turns}|{}",
        risk.trim().to_lowercase(),
        reward_tier.trim().to_lowercase(),
        attributes.join(",")
    )
}

pub(crate) fn npc_archetype_signature(identity: &str, personality: &str) -> String {
    format!(
        "{}|{}",
        normalize_text(identity),
        normalize_text(personality)
    )
}

fn normalize_text(value: &str) -> String {
    let mut result = String::new();
    let mut pending_space = false;
    for character in value.trim().chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() {
            if pending_space && !result.is_empty() {
                result.push(' ');
            }
            result.push(character);
            pending_space = false;
        } else {
            pending_space = true;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_phrases_quest_structures_and_npc_archetypes_deterministically() {
        assert_eq!(
            find_repeated_phrase([
                "潮水正在越过废弃灯塔下方的旧堤岸。",
                "潮水正在越过废弃灯塔下方的旧堤岸！",
            ]),
            Some("潮水正在越过废弃灯塔下方的旧堤岸".to_owned())
        );
        assert_eq!(
            find_repeated_phrase_against(
                ["The lighthouse door must remain sealed until dawn."],
                ["The lighthouse door must remain sealed until dawn."],
            ),
            Some("the lighthouse door must remain sealed until dawn".to_owned())
        );
        assert_eq!(
            quest_structure_signature(
                "MODERATE",
                "NOTABLE",
                8,
                12,
                &["knowledge".to_owned(), "agility".to_owned()],
            ),
            "moderate|notable|8-12|agility,knowledge"
        );
        assert_eq!(
            npc_archetype_signature("Harbor Scout", "Quiet, watchful."),
            "harbor scout|quiet watchful"
        );
    }
}
