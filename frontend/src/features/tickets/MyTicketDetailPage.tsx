import { FormEvent, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, staffToken, ticketDisplayId, Attachment, Comment, TicketDetail } from '../../lib/api';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Read-only on status/assignment — an employee can see their own ticket but
// can't assign or transition it, that's staff work. See TicketDetailPage for
// the staff-facing equivalent with those controls. Comments ARE two-way
// here: the employee can see every PUBLIC reply an agent posts (never
// INTERNAL notes) and reply back themselves — same thread, just filtered.
export function MyTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const token = staffToken.get();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    api.getMyTicket(id, token).then(setTicket).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load ticket'));
  }, [id, token]);

  useEffect(() => {
    if (!id) return;
    api.listMyComments(id, token).then(setComments).catch(() => {});
  }, [id, token]);

  useEffect(() => {
    if (!id) return;
    api.listMyAttachments(id, token).then(setAttachments).catch(() => {});
  }, [id, token]);

  async function onPostComment(e: FormEvent) {
    e.preventDefault();
    if (!id || !commentBody.trim()) return;
    setPostingComment(true);
    setError(null);
    try {
      const comment = await api.addMyComment(id, commentBody.trim(), token);
      setComments((prev) => [...prev, comment]);
      setCommentBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post this comment');
    } finally {
      setPostingComment(false);
    }
  }

  async function onUploadAttachment(e: FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!id || !file) return;
    setUploadingAttachment(true);
    setAttachmentError(null);
    try {
      const uploaded = await api.uploadMyAttachment(id, file, token);
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

  if (error) return <p className="error">{error}</p>;
  if (!ticket) return <p>Loading…</p>;

  const currentLabel = ticket.ticketTypeVersion.statusSchemaSnapshot.statuses.find((s) => s.key === ticket.statusKey)?.label ?? ticket.statusKey;

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>
          <span className="ticket-id-badge">{ticketDisplayId(ticket)}</span> {ticket.subject}
        </h1>
        <span className={`priority-chip priority-${ticket.priority.toLowerCase()}`}>{ticket.priority}</span>
      </div>

      <p className="ticket-meta">
        {ticket.department.name} · {ticket.ticketTypeDefinition.name} · raised {new Date(ticket.createdAt).toLocaleString()}
      </p>

      <p className="status-line">
        Status: <strong>{currentLabel}</strong>
      </p>

      <section className="ticket-description">
        <h2>Description</h2>
        <p>{ticket.description}</p>
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
        <p className="comment-empty">A screenshot of the problem helps — images, PDFs, or plain text, 5MB max.</p>
        {attachmentError && <p className="error">{attachmentError}</p>}
      </section>

      <section className="ticket-comments">
        <h2>Updates &amp; replies</h2>
        <div className="comment-list">
          {comments.length === 0 && <p className="comment-empty">No replies yet.</p>}
          {comments.map((c) => (
            <div key={c.id} className="comment-item">
              <div className="comment-item-head">
                <span className="comment-author">{c.staffAuthor?.name ?? 'Support team'}</span>
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
            placeholder="Add more detail or ask a question about this ticket…"
            required
          />
          <div className="comment-form-actions">
            <span />
            <button type="submit" disabled={postingComment || !commentBody.trim()}>
              {postingComment ? 'Posting…' : 'Post'}
            </button>
          </div>
        </form>
      </section>

      <section className="ticket-sla">
        <h2>Response time</h2>
        <dl>
          <div>
            <dt>Expected by</dt>
            <dd>{ticket.responseDueAt ? new Date(ticket.responseDueAt).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt>First response</dt>
            <dd>{ticket.firstRespondedAt ? new Date(ticket.firstRespondedAt).toLocaleString() : 'Not yet'}</dd>
          </div>
          <div>
            <dt>Resolved</dt>
            <dd>{ticket.resolvedAt ? new Date(ticket.resolvedAt).toLocaleString() : 'Not yet'}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
