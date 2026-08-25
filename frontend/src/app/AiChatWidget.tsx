import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, ChatTurn, staffToken } from '../lib/api';

// Floating assistant, available on every /app/* page (mounted once in
// StaffLayout, not per-page) — the 4th originally-scoped AI feature. Scoped
// to whatever tickets the caller can already see (see ai.service.ts's
// buildChatContext); it can discuss ticket status but never changes
// anything, same human-in-the-loop spirit as triage/draft-reply/insights.
export function AiChatWidget() {
  const token = staffToken.get();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, open]);

  async function onSend(e: FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || sending) return;
    setError(null);
    setInput('');
    const history = turns; // snapshot before this turn is appended, matches api.chat's contract
    setTurns((prev) => [...prev, { role: 'user', text: message }]);
    setSending(true);
    try {
      const { reply } = await api.chat(message, history, token);
      setTurns((prev) => [...prev, { role: 'assistant', text: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The assistant could not respond');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="ai-chat-widget">
      {open && (
        <div className="ai-chat-panel">
          <div className="ai-chat-panel-head">
            <span>✨ Assistant</span>
            <button type="button" className="ai-chat-close" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="ai-chat-messages">
            {turns.length === 0 && (
              <p className="ai-chat-empty">
                Ask about your tickets, or anything else you need a hand with. This can't create, assign, or close tickets for you.
              </p>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`ai-chat-bubble ai-chat-bubble-${t.role}`}>
                {t.text}
              </div>
            ))}
            {sending && <div className="ai-chat-bubble ai-chat-bubble-assistant ai-chat-thinking">…</div>}
            {error && <p className="error">{error}</p>}
            <div ref={bottomRef} />
          </div>
          <form className="ai-chat-input-row" onSubmit={onSend}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message…"
              disabled={sending}
            />
            <button type="submit" disabled={sending || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
      <button type="button" className="ai-chat-launcher" onClick={() => setOpen((o) => !o)} aria-label="Open assistant">
        {open ? '×' : '✨'}
      </button>
    </div>
  );
}
