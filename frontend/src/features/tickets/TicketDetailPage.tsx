import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { api, staffToken, staffUser, ticketDisplayId, Attachment, Comment, CommentVisibility, StaffMember, TicketDetail } from '../../lib/api';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const token = staffToken.get();
  const me = staffUser.get();

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [notifyMessage, setNotifyMessage] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentVisibility, setCommentVisibility] = useState<CommentVisibility>('PUBLIC');
  const [postingComment, setPostingComment] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Only present for one page load, right after creation (router state,
  // not persisted) — see api.ts's CreatedTicket / tickets.service.ts's
  // create() comment on why this isn't stored on the ticket itself.
  const [autoAssignNote] = useState<string | null>((location.state as { autoAssignReasoning?: string | null } | null)?.autoAssignReasoning ?? null);

  const load = useCallback(() => {
    if (!id) return;
    api.getTicket(id, token).then(setTicket).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load ticket'));
  }, [id, token]);

  const loadComments = useCallback(() => {
    if (!id) return;
    api.listComments(id, token).then(setComments).catch(() => {});
  }, [id, token]);

  const loadAttachments = useCallback(() => {
    if (!id) return;
    api.listAttachments(id, token).then(setAttachments).catch(() => {});
  }, [id, token]);

  useEffect(() => load(), [load]);
  useEffect(() => loadComments(), [loadComments]);
  useEffect(() => loadAttachments(), [loadAttachments]);

  useEffect(() => {
    // Must be the TICKET's department, not the viewer's own — a SUPER_ADMIN
    // has no departmentId of their own (org-wide, not scoped to one), so
    // using me.departmentId here left staffMembers permanently empty for
    // that role: the "Assigned to" dropdown had only the Unassigned option
    // to show, so it displayed as unassigned even on a ticket that WAS
    // assigned (the real assignedAgent.id just had no matching <option>).
    if (ticket?.departmentId) api.listDepartmentUsers(ticket.departmentId, token).then(setStaffMembers);
  }, [ticket?.departmentId, token]);

  if (error) return <p className="error">{error}</p>;
  if (!ticket) return <p>Loading…</p>;

  const statuses = ticket.ticketTypeVersion.statusSchemaSnapshot.statuses;
  const currentLabel = statuses.find((s) => s.key === ticket.statusKey)?.label ?? ticket.statusKey;
  const availableMoves = ticket.ticketTypeVersion.statusSchemaSnapshot.transitions.filter(
    (t) =>
      t.fromStatusKey === ticket.statusKey &&
      (t.allowedRoles.length === 0 || t.allowedRoles.includes(me?.role ?? '') || me?.role === 'SUPER_ADMIN'),
  );

  async function onAssign(agentId: string) {
    if (!ticket) return;
    try {
      setTicket(await api.assignTicket(ticket.id, agentId || null, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reassign this ticket');
    }
  }

  async function onTransition(toStatusKey: string) {
    if (!ticket) return;
    try {
      setTicket(await api.transitionTicket(ticket.id, toStatusKey, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change status');
    }
  }

  async function onEscalate() {
    if (!ticket) return;
    try {
      setTicket(await api.escalateTicket(ticket.id, undefined, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not escalate this ticket');
    }
  }

  async function onAcknowledge() {
    if (!ticket) return;
    try {
      setTicket(await api.acknowledgeEscalation(ticket.id, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not acknowledge this escalation');
    }
  }

  // Reversible — a confirm() is enough friction for "hide, not delete."
  async function onArchive() {
    if (!ticket) return;
    if (!window.confirm('Archive this ticket? It will be hidden from the queue and dashboard, but can be unarchived anytime.')) return;
    try {
      setTicket(await api.archiveTicket(ticket.id, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not archive this ticket');
    }
  }

  async function onUnarchive() {
    if (!ticket) return;
    try {
      setTicket(await api.unarchiveTicket(ticket.id, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unarchive this ticket');
    }
  }

  // Calm, non-urgent — unlike escalate, this never changes the ticket
  // itself, so there's nothing to setTicket() with; just confirm it sent.
  async function onNotifyManager() {
    if (!ticket) return;
    setNotifyMessage(null);
    try {
      await api.notifyManager(ticket.id, undefined, token);
      setNotifyMessage('✅ Manager notified — no action needed from them, just keeping them posted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not notify the manager');
    }
  }

  async function onDraftReply() {
    if (!ticket) return;
    setDrafting(true);
    setError(null);
    try {
      const { draft } = await api.draftReply(ticket.id, token);
      setDraft(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not draft a reply');
    } finally {
      setDrafting(false);
    }
  }

  // Pulls the AI draft into the comment box below instead of just sitting
  // there as a copy-paste box — still fully editable before posting.
  function useDraftAsComment() {
    if (!draft) return;
    setCommentBody(draft);
    setCommentVisibility('PUBLIC');
    setDraft(null);
  }

  async function onPostComment(e: FormEvent) {
    e.preventDefault();
    if (!ticket || !commentBody.trim()) return;
    setPostingComment(true);
    setError(null);
    try {
      const comment = await api.addComment(ticket.id, commentBody.trim(), commentVisibility, token);
      setComments((prev) => [...prev, comment]);
      setCommentBody('');
      if (commentVisibility === 'PUBLIC' && !ticket.firstRespondedAt) {
        // Mirrors the backend's own side effect (addComment stamps
        // firstRespondedAt on the first PUBLIC reply) — refetch so the SLA
        // panel below reflects it without a manual reload.
        load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post this comment');
    } finally {
      setPostingComment(false);
    }
  }

  async function onUploadAttachment(e: FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!ticket || !file) return;
    setUploadingAttachment(true);
    setAttachmentError(null);
    try {
      const uploaded = await api.uploadAttachment(ticket.id, file, token);
      setAttachments((prev) => [...prev, uploaded]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : 'Could not upload this file');
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function onDownloadAttachment(a: Attachment) {
    try {
      await api.downloadAttachment(a.id, a.fileName, token);
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : 'Could not download this file');
    }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>
          <span className="ticket-id-badge">{ticketDisplayId(ticket)}</span> {ticket.subject}
        </h1>
        <div className="page-header-actions">
          <span className={`priority-chip priority-${ticket.priority.toLowerCase()}`}>{ticket.priority}</span>
          {(me?.role === 'DEPT_ADMIN' || me?.role === 'SUPER_ADMIN') &&
            (ticket.isArchived ? (
              <button type="button" className="archive-button" onClick={onUnarchive}>
                Unarchive
              </button>
            ) : (
              <button type="button" className="archive-button" onClick={onArchive}>
                Archive
              </button>
            ))}
        </div>
      </div>

      <p className="ticket-meta">
        {ticket.ticketTypeDefinition.name} · {ticket.customer.name} ({ticket.customer.email})
        {ticket.company && ` · ${ticket.company.name}`} · opened {new Date(ticket.createdAt).toLocaleString()}
      </p>

      {ticket.isArchived && (
        <div className="archive-banner">
          📦 Archived{ticket.archivedAt && ` on ${new Date(ticket.archivedAt).toLocaleString()}`} — hidden from the queue and dashboard.
        </div>
      )}

      {ticket.isEscalated && (
        <div className="escalation-banner">
          <span>
            🚩 Escalated ({ticket.escalationReason?.replace(/_/g, ' ').toLowerCase()})
            {ticket.escalatedAt && ` on ${new Date(ticket.escalatedAt).toLocaleString()}`}
            {ticket.escalationAcknowledgedAt && ' — acknowledged'}
          </span>
          {!ticket.escalationAcknowledgedAt && (me?.role === 'DEPT_ADMIN' || me?.role === 'SUPER_ADMIN') && (
            <button type="button" className="escalation-acknowledge" onClick={onAcknowledge}>
              Acknowledge
            </button>
          )}
        </div>
      )}

      <p className="status-line">
        Status: <strong>{currentLabel}</strong>
        {availableMoves.map((m) => {
          const label = statuses.find((s) => s.key === m.toStatusKey)?.label ?? m.toStatusKey;
          return (
            <button key={m.toStatusKey} className="status-move" onClick={() => onTransition(m.toStatusKey)}>
              → {label}
            </button>
          );
        })}
        {!ticket.isEscalated && (
          <button type="button" className="status-move escalate-button" onClick={onEscalate}>
            🚩 Escalate
          </button>
        )}
        <button type="button" className="status-move notify-manager-button" onClick={onNotifyManager}>
          📣 Notify manager
        </button>
      </p>
      {notifyMessage && <p className="notify-manager-confirm">{notifyMessage}</p>}

      <label className="inline-filter">
        Assigned to
        <select value={ticket.assignedAgent?.id ?? ''} onChange={(e) => onAssign(e.target.value)}>
          <option value="">Unassigned</option>
          {staffMembers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {autoAssignNote && <p className="auto-assign-note">🤖 Auto-assigned by AI — {autoAssignNote}</p>}

      <section className="ticket-description">
        <h2>Description</h2>
        <p>{ticket.description}</p>
      </section>

      <section className="ai-draft-section">
        <button type="button" onClick={onDraftReply} disabled={drafting}>
          ✨ {drafting ? 'Drafting…' : 'Draft a reply with AI'}
        </button>
        {draft && (
          <div className="ai-draft-box">
            <p className="dash-subtitle">Suggested reply — review before sending, AI can get things wrong:</p>
            <textarea readOnly value={draft} rows={6} />
            <button type="button" onClick={useDraftAsComment}>
              Use as reply below
            </button>
          </div>
        )}
      </section>

      <section className="ticket-attachments">
        <h2>Attachments</h2>
        <div className="attachment-list">
          {attachments.length === 0 && <p className="comment-empty">No files attached yet.</p>}
          {attachments.map((a) => (
            <button key={a.id} type="button" className="attachment-item" onClick={() => onDownloadAttachment(a)}>
              📎 {a.fileName} <span className="attachment-size">({formatFileSize(a.size)})</span>
            </button>
          ))}
        </div>
        <form className="attachment-form" onSubmit={onUploadAttachment}>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain" />
          <button type="submit" disabled={uploadingAttachment}>
            {uploadingAttachment ? 'Uploading…' : 'Attach file'}
          </button>
        </form>
        <p className="comment-empty">Images, PDFs, or plain text — 5MB max.</p>
        {attachmentError && <p className="error">{attachmentError}</p>}
      </section>

      <section className="ticket-comments">
        <h2>Comments</h2>
        <div className="comment-list">
          {comments.length === 0 && <p className="comment-empty">No comments yet.</p>}
          {comments.map((c) => (
            <div key={c.id} className={`comment-item comment-${c.visibility.toLowerCase()}`}>
              <div className="comment-item-head">
                <span className="comment-author">
                  {c.staffAuthor?.name ?? c.customerAuthor?.name ?? 'Unknown'}
                  {c.staffAuthor && ` (${c.staffAuthor.role.replace('_', ' ')})`}
                </span>
                <span className={`comment-visibility-badge comment-visibility-${c.visibility.toLowerCase()}`}>
                  {c.visibility === 'INTERNAL' ? '🔒 Internal note' : '💬 Reply to requester'}
                </span>
                <span className="comment-time">{new Date(c.createdAt).toLocaleString()}</span>
              </div>
              <p className="comment-body">{c.body}</p>
            </div>
          ))}
        </div>

        <form className="comment-form" onSubmit={onPostComment}>
          <textarea
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            rows={3}
            placeholder="Write a reply to the requester, or an internal note for the team…"
            required
          />
          <div className="comment-form-actions">
            <label className="comment-visibility-toggle">
              <select value={commentVisibility} onChange={(e) => setCommentVisibility(e.target.value as CommentVisibility)}>
                <option value="PUBLIC">💬 Reply to requester</option>
                <option value="INTERNAL">🔒 Internal note (team only)</option>
              </select>
            </label>
            <button type="submit" disabled={postingComment || !commentBody.trim()}>
              {postingComment ? 'Posting…' : 'Post'}
            </button>
          </div>
        </form>
      </section>

      {Object.keys(ticket.customFields).length > 0 && (
        <section className="ticket-custom-fields">
          <h2>Details</h2>
          <dl>
            {Object.entries(ticket.customFields).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="ticket-sla">
        <h2>SLA</h2>
        <dl>
          <div>
            <dt>Response due</dt>
            <dd>{ticket.responseDueAt ? new Date(ticket.responseDueAt).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt>Resolution due</dt>
            <dd>{ticket.resolutionDueAt ? new Date(ticket.resolutionDueAt).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt>First responded</dt>
            <dd>{ticket.firstRespondedAt ? new Date(ticket.firstRespondedAt).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt>Resolved</dt>
            <dd>{ticket.resolvedAt ? new Date(ticket.resolvedAt).toLocaleString() : '—'}</dd>
          </div>
        </dl>
      </section>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
