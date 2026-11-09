import { Button } from "../../components/ui/Button";
import { ButtonRow } from "../../components/ui/ButtonRow";
import { Card } from "../../components/ui/Card";
import { Note } from "../../components/ui/Note";
import { cx } from "../../components/ui/cx";
import { canSubmit, MIN_ZONE_POINTS, shownZones } from "./geofenceEditorReducer";
import type { GeofenceEditor } from "./useGeofenceEditor";
import styles from "./GeofenceCard.module.css";

interface GeofenceCardProps {
  editor: GeofenceEditor;
  /** Another map tool is active: editing can't start. */
  disabled: boolean;
}

/** Lists the restricted zones, and edits them on the map until Submit or Cancel. */
export function GeofenceCard({ editor: { state, dispatch, submit, submitting, error }, disabled }: GeofenceCardProps) {
  const editing = state.draft !== null;
  const zones = shownZones(state);

  return (
    <Card title="Geofences">
      {zones.length === 0 ? (
        <Note>{editing ? "Click the map to start a zone." : "No geofences."}</Note>
      ) : (
        <ul className={styles.list}>
          {zones.map((zone) => (
            <li key={zone.zoneId} className={cx(styles.item, zone.zoneId === state.selectedZoneId && styles.selected)}>
              <button
                type="button"
                className={styles.zone}
                disabled={!editing}
                onClick={() => dispatch({ type: "SELECT_ZONE", zoneId: zone.zoneId })}
              >
                <span>{zone.zoneId}</span>
                <span className={cx(styles.count, zone.points.length < MIN_ZONE_POINTS && styles.incomplete)}>
                  {zone.points.length} points
                </span>
              </button>
              {editing && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${zone.zoneId}`}
                  onClick={() => dispatch({ type: "DELETE_ZONE", zoneId: zone.zoneId })}
                >
                  Delete
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <>
          <Note size="sm" className={styles.hint}>
            Click the map to add a point. Drag a point to move it, or a small dot to insert one.
          </Note>
          <ButtonRow marginTop={12}>
            <Button block onClick={() => dispatch({ type: "ADD_ZONE" })}>
              Add zone
            </Button>
            <Button
              block
              variant="danger"
              disabled={state.selectedPointId === null}
              onClick={() => dispatch({ type: "DELETE_POINT" })}
            >
              Delete point
            </Button>
          </ButtonRow>
          <ButtonRow marginTop={8}>
            <Button block disabled={submitting} onClick={() => dispatch({ type: "CANCEL_EDIT" })}>
              Cancel
            </Button>
            <Button block variant="primary" disabled={submitting || !canSubmit(state)} onClick={submit}>
              Submit
            </Button>
          </ButtonRow>
        </>
      ) : (
        <ButtonRow marginTop={12}>
          <Button block disabled={disabled} onClick={() => dispatch({ type: "BEGIN_EDIT" })}>
            Edit
          </Button>
        </ButtonRow>
      )}

      {error && (
        <Note tone="danger" size="sm" className={styles.hint}>
          {error}
        </Note>
      )}
    </Card>
  );
}
