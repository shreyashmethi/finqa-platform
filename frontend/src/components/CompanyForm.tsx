// "Add a company" dialog (admins), used on the Upload and Companies pages. Validates the same
// rules as the API (ID pattern, three-letter currency) so mistakes show before saving.
import { useState } from "react";
import { api } from "../api";
import type { Company } from "../types";
import { ErrorNote, Modal } from "./Marks";

export function NewCompany({ open, onClose, onCreated, existing }: { open: boolean; onClose: () => void; onCreated: (c: Company) => void; existing: Company[] }) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [fye, setFye] = useState("31 December");
  const [segments, setSegments] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) return setError("The ID can use letters, digits, - and _ (up to 32 characters), e.g. C051.");
    if (existing.some((c) => c.id === id)) return setError(`A company with ID ${id} already exists.`);
    if (!name.trim()) return setError("Enter the company name.");
    if (!/^[A-Z]{3}$/.test(currency)) return setError("Currency is a three-letter code, e.g. USD or INR.");
    setBusy(true);
    try {
      const c = await api.createCompany({
        id,
        name: name.trim(),
        sector: sector.trim() || undefined,
        currency,
        fiscal_year_end: fye.trim() || undefined,
        segments: segments.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setId("");
      setName("");
      setSector("");
      setSegments("");
      onCreated(c);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Add a company"
      onClose={onClose}
      footer={
        <>
          <button className="quiet-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Add company"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          Company ID
          <input value={id} onChange={(e) => setId(e.target.value.trim())} placeholder="C051" autoFocus />
        </label>
        <label>
          Reporting currency
          <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} placeholder="USD" />
        </label>
        <label className="span-2">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Example Holdings plc" />
        </label>
        <label>
          Sector
          <input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Industrial" />
        </label>
        <label>
          Fiscal year ends
          <input value={fye} onChange={(e) => setFye(e.target.value)} placeholder="31 December" />
        </label>
        <label className="span-2">
          Segments <small className="quiet">comma separated, as they are named in the reports</small>
          <input value={segments} onChange={(e) => setSegments(e.target.value)} placeholder="Machinery, Services" />
        </label>
      </div>
      <ErrorNote message={error} />
    </Modal>
  );
}
