use rusqlite::{Connection, OptionalExtension, params};

use crate::CampaignStoreError;

pub(crate) fn reconcile_lazy_artifact(
    connection: &Connection,
    campaign_id: &str,
    kind: &str,
    target_id: &str,
    artifact_ref: &str,
    at: &str,
) -> Result<(), CampaignStoreError> {
    let current = connection
        .query_row(
            "SELECT intent_key,state,active_run_id,revision
             FROM lazy_world_generation_plans
             WHERE campaign_id=?1 AND kind=?2 AND target_id=?3",
            params![campaign_id, kind, target_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()?;
    let Some((intent_key, state, run_id, revision)) = current else {
        // Migrated legacy campaigns have no bootstrap plan. Their existing commit
        // path must remain valid; only newly confirmed worlds are plan-managed.
        return Ok(());
    };
    if state == "SUCCEEDED" {
        return Ok(());
    }
    let reason = if state == "RUNNING" {
        "ARTIFACT_COMMITTED"
    } else {
        "RECONCILED"
    };
    let changed = connection.execute(
        "UPDATE lazy_world_generation_plans SET
           state='SUCCEEDED',active_run_id=NULL,artifact_ref=?1,last_error_code=NULL,
           retryable=0,revision=?2,completed_at=?3,updated_at=?3
         WHERE intent_key=?4 AND campaign_id=?5 AND revision=?6",
        params![
            artifact_ref,
            revision + 1,
            at,
            intent_key,
            campaign_id,
            revision
        ],
    )?;
    if changed != 1 {
        return Err(CampaignStoreError::InvalidState);
    }
    connection.execute(
        "INSERT INTO lazy_world_generation_transitions (
           campaign_id,intent_key,from_state,to_state,reason,run_id,before_revision,
           after_revision,error_code,retryable,occurred_at
         ) VALUES (?1,?2,?3,'SUCCEEDED',?4,?5,?6,?7,NULL,0,?8)",
        params![
            campaign_id,
            intent_key,
            state,
            reason,
            run_id,
            revision,
            revision + 1,
            at
        ],
    )?;
    Ok(())
}
