import { useState, type FormEvent } from "react";
import type { DashboardRoom } from "../../shared/dashboard";
import type { PlanOption } from "../../shared/room-model";

const fields = [
  ["description", "Description"],
  ["date", "Date"],
  ["time", "Time"],
  ["location", "Location"],
  ["transport", "Transportation"],
  ["preparation", "Preparation"],
] as const;

export function ReceiptEditor({
  room,
  onSave,
}: {
  room: DashboardRoom;
  onSave: (revision: number, proposal: PlanOption) => Promise<void>;
}) {
  const [base, setBase] = useState<DashboardRoom | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!base || saving) return;
    const form = new FormData(event.currentTarget);
    const label = String(form.get("title") ?? "").trim();
    if (!label) {
      setError("Enter an event name.");
      return;
    }
    const values = { ...base.proposal.values };
    if (typeof values.title === "string") values.title = label;
    for (const [key] of fields) {
      const value = String(form.get(key) ?? "").trim();
      if (value) values[key] = value;
      else if (typeof values[key] === "string") delete values[key];
    }
    if (
      label === base.proposal.label &&
      JSON.stringify(values) === JSON.stringify(base.proposal.values)
    ) {
      setBase(null);
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave(base.revision, { ...base.proposal, label, values });
      setBase(null);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The proposal could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!base)
    return (
      <button
        type="button"
        className="dashboard-button subtle"
        onClick={() => {
          setError("");
          setBase(room);
        }}
      >
        Edit proposal
      </button>
    );

  const stale = base.revision !== room.revision;
  return (
    <form
      className="decision-receipt-edit"
      onSubmit={(event) => void save(event)}
    >
      <h3>Edit the room proposal</h3>
      <p>
        Saving changes creates a new proposal for the group to review and
        approve.
      </p>
      <div>
        <label>
          Event name
          <input
            name="title"
            required
            maxLength={120}
            defaultValue={base.proposal.label}
          />
        </label>
        {fields.map(([key, label]) => {
          const value = base.proposal.values[key];
          return (
            <label key={key}>
              {label}
              <input
                name={key}
                maxLength={500}
                defaultValue={typeof value === "string" ? value : ""}
              />
            </label>
          );
        })}
      </div>
      {stale && (
        <p role="status">
          The room changed while you were editing. Cancel and reopen the editor
          to use the latest proposal.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="decision-receipt-actions">
        <button
          type="submit"
          className="dashboard-button primary"
          disabled={saving || stale}
        >
          Save proposal
        </button>
        <button
          type="button"
          className="dashboard-button subtle"
          disabled={saving}
          onClick={() => setBase(null)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
