import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, staffToken, staffUser, ticketDisplayId, BulkAssistItem, Department } from '../../lib/api';

// "Handle many tickets at once, human still approves" — Deepak's ask,
// 2026-08-25. Runs AI over every open/not-yet-responded ticket in a
// department in one pass (draft reply + suggested assignee for each,
// generated in parallel server-side — see ai.service.ts's bulkAssist).
// Nothing is applied until a card is individually approved or swept up by
// "Approve all shown" — approving just calls the same addComment/
// assignTicket a human would call from the ticket page itself.
type ItemState = BulkAssistItem & { draftText: string; assignChecked: boolean; status: 'pending' | 'approving' | 'approved' | 'skipped' | 'error'; error?: string };

export function BulkAssistPage() {
  const token = staffToken.get();
  const me = staffUser.get();
  const isSuperAdmin = me?.role === 'SUPER_ADMIN';

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState(me?.departmentId ?? '');
  const [items, setItems] = useState<ItemState[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [running, setRunning] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    api
      .listDepartments(token)
      .then((all) => {
        setDepartments(all);
        setDepartmentId((current) => current || all[0]?.id || '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load departments'));
  }, [isSuperAdmin, token]);

  async function onRun() {
    if (!departmentId) return;
    setRunning(true);
    setError(null);
    setItems(null);
    try {
      const result = await api.bulkAssist(departmentId, token);
      setTruncated(result.truncated);
      setItems(
        result.items.map((item) => ({
          ...item,
          draftText: item.draft ?? '',
          assignChecked: !!item.suggestedAgent,
          status: 'pending',
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run AI on this queue');
    } finally {
      setRunning(false);
    }
  }

  function updateItem(ticketId: string, patch: Partial<ItemState>) {
    setItems((prev) => prev?.map((it) => (it.ticketId === ticketId ? { ...it, ...patch } : it)) ?? null);
  }

  async function approveOne(item: ItemState) {
    updateItem(item.ticketId, { status: 'approving' });
    try {
      if (item.assignChecked && item.suggestedAgent) {
        await api.assignTicket(item.ticketId, item.suggestedAgent.agentId, token);
      }
      if (item.draftText.trim()) {
        await api.addComment(item.ticketId, item.draftText.trim(), 'PUBLIC', token);
      }
      updateItem(item.ticketId, { status: 'approved' });
    } catch (err) {
      updateItem(item.ticketId, { status: 'error', error: err instanceof Error ? err.message : 'Failed' });
    }
  }

  async function onApproveAll() {
    if (!items) return;
    setApprovingAll(true);
    // Sequential, not Promise.all — these are real writes (assign +
    // comment) hitting the same backend a human clicking through one by
    // one would, no reason to fire them all at once.
    for (const item of items) {
      if (item.status === 'pending') await approveOne(item);
    }
    setApprovingAll(false);
  }

  return (
    <div className="page-shell">
      <h1>✨ Bulk AI Assist</h1>
      <p className="dash-subtitle">
        Drafts a reply and suggests who should work it, for every open ticket that hasn't been responded to yet. Nothing
        sends until you approve it, one at a time or all together. This works through tickets one at a time behind the
        scenes to stay within the AI service's rate limit, so a full queue can take a little while — the page will just
        sit on "Thinking…" until it's done.
      </p>

      {isSuperAdmin && (
        <label className="inline-filter">
          Department
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <button type="button" className="builder-publish-button" onClick={onRun} disabled={running || !departmentId}>
        {running ? 'Thinking…' : items ? 'Run again' : 'Run AI on open tickets'}
      </button>

      {error && <p className="error">{error}</p>}
      {truncated && (
        <p className="notify-manager-confirm">
          Showing the first 20 — there are more open tickets than that. Approve or skip these, then run again for the rest.
        </p>
      )}

      {items && items.length === 0 && <p className="comment-empty">Nothing to do — every open ticket already has a first response.</p>}

      {items && items.length > 0 && (
        <>
          <button type="button" onClick={onApproveAll} disabled={approvingAll || items.every((i) => i.status !== 'pending')}>
            {approvingAll ? 'Approving…' : 'Approve all shown'}
          </button>

          <div className="bulk-assist-list">
            {items.map((item) => (
              <div key={item.ticketId} className={`bulk-assist-card bulk-assist-${item.status}`}>
                <div className="bulk-assist-card-head">
                  <Link to={`/app/tickets/${item.ticketId}`}>
                    <span className="ticket-id-badge">{item.displayId}</span> {item.subject}
                  </Link>
                  <span className={`priority-chip priority-${item.priority.toLowerCase()}`}>{item.priority}</span>
                </div>

                {item.suggestedAgent ? (
                  <label className="builder-checkbox">
                    <input
                      type="checkbox"
                      checked={item.assignChecked}
                      onChange={(e) => updateItem(item.ticketId, { assignChecked: e.target.checked })}
                      disabled={item.status !== 'pending'}
                    />
                    Assign to <strong>{item.suggestedAgent.name}</strong> — {item.suggestedAgent.reasoning}
                  </label>
                ) : (
                  <p className="comment-empty">
                    {item.currentAssigneeName ? `Already assigned to ${item.currentAssigneeName}.` : 'No assignment suggestion.'}
                  </p>
                )}

                {item.draft === null ? (
                  <p className="comment-empty">
                    AI couldn't draft a reply for this one (it may have hit a rate limit) — write your own below, or skip
                    it and run this again shortly.
                  </p>
                ) : null}
                <textarea
                  className="bulk-assist-draft"
                  value={item.draftText}
                  onChange={(e) => updateItem(item.ticketId, { draftText: e.target.value })}
                  rows={3}
                  disabled={item.status !== 'pending'}
                  placeholder="No reply will be posted if this is left empty"
                />

                {item.status === 'error' && <p className="error">{item.error}</p>}

                {item.status === 'pending' && (
                  <div className="bulk-assist-actions">
                    <button type="button" onClick={() => approveOne(item)}>
                      Approve
                    </button>
                    <button type="button" className="bulk-assist-skip" onClick={() => updateItem(item.ticketId, { status: 'skipped' })}>
                      Skip
                    </button>
                  </div>
                )}
                {item.status === 'approving' && <p className="comment-empty">Applying…</p>}
                {item.status === 'approved' && <p className="notify-manager-confirm">✅ Done</p>}
                {item.status === 'skipped' && <p className="comment-empty">Skipped.</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
