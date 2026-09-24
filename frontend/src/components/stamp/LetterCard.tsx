"use client";
import { useState } from 'react';
import { Cl } from '@stacks/transactions';
import {
  MAX_CHARS,
  STATUS,
  callDeny,
  charCount,
  contractPays,
  formatDuration,
  formatStx,
  shortAddress,
  type Letter,
} from '@/lib/stamp';
import { useTx } from '@/lib/useTx';
import { TxNote } from './TxNote';

function when(seconds: bigint) {
  return new Date(Number(seconds) * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function Postmark({ letter, fresh }: { letter: Letter; fresh: boolean }) {
  if (letter.status === STATUS.pending) return null;
  const replied = letter.status === STATUS.replied;
  const reason = letter.status === STATUS.declined ? 'declined' : 'no reply';
  return (
    <div className={`postmark ${replied ? 'is-replied' : 'is-returned'} ${fresh ? 'just-landed' : ''}`} aria-hidden>
      <span>
        {replied ? 'Replied' : 'Returned'}
        <small>{replied ? `${formatStx(letter.paid)} STX` : reason}</small>
      </span>
    </div>
  );
}

export function LetterCard({
  letter,
  view,
  now,
  onSettled,
}: {
  letter: Letter;
  view: 'inbox' | 'sent';
  now: number;
  onSettled: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [landed, setLanded] = useState(false);
  const settle = () => {
    setLanded(true);
    onSettled();
  };
  const reply = useTx(settle);
  const decline = useTx(settle);
  const reclaim = useTx(settle);

  const pending = letter.status === STATUS.pending;
  const left = Number(letter.deadline) - now;
  const open = pending && left > 0;
  const busy = reply.busy || decline.busy || reclaim.busy;
  const other = view === 'inbox' ? letter.from : letter.to;
  const count = charCount(draft);
  const pays = [contractPays(letter.paid)];

  return (
    <article className={`sheet ${pending ? '' : 'is-settled'}`}>
      <header className="flex flex-wrap items-baseline gap-x-3 text-sm">
        <span className="font-semibold" title={other}>
          {view === 'inbox' ? 'From' : 'To'} {shortAddress(other)}
        </span>
        <span className="muted">{when(letter.sentAt)}</span>
        <span className="muted">{formatStx(letter.paid)} STX stamp</span>
      </header>

      <p className="typed mt-3 whitespace-pre-wrap break-words text-[17px] leading-relaxed">{letter.body}</p>

      {letter.reply && (
        <div className="mt-4 border-l-2 pl-4" style={{ borderColor: 'var(--ok)' }}>
          <p className="muted text-sm">{view === 'inbox' ? 'You replied' : 'They replied'}</p>
          <p className="typed whitespace-pre-wrap break-words text-[17px] leading-relaxed">{letter.reply}</p>
        </div>
      )}

      <Postmark letter={letter} fresh={landed} />

      {view === 'inbox' && open && (
        <div className="mt-4 space-y-3">
          <p className="muted text-sm">Reply within {formatDuration(left)} to collect {formatStx(letter.paid)} STX.</p>
          <label className="sr-only" htmlFor={`reply-${letter.id}`}>
            Your reply
          </label>
          <textarea
            id={`reply-${letter.id}`}
            className="field typed min-h-[96px] text-[16px]"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Write your reply"
            disabled={busy}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="btn"
              disabled={busy || count === 0 || count > MAX_CHARS}
              onClick={() =>
                reply.run(() => callDeny('reply', [Cl.uint(letter.id), Cl.stringUtf8(draft.trim())], pays))
              }
            >
              Reply and collect {formatStx(letter.paid)} STX
            </button>
            <button
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => decline.run(() => callDeny('decline', [Cl.uint(letter.id)], pays))}
            >
              Decline and refund
            </button>
            <span className="muted ml-auto text-sm" style={count > MAX_CHARS ? { color: 'var(--red)' } : undefined}>
              {count} / {MAX_CHARS}
            </span>
          </div>
          <TxNote state={reply.state} link={reply.link} />
          <TxNote state={decline.state} link={decline.link} />
        </div>
      )}

      {view === 'inbox' && pending && !open && (
        <p className="muted mt-4 text-sm">The reply window closed. The sender can take their STX back.</p>
      )}

      {view === 'sent' && open && (
        <p className="muted mt-4 text-sm">Waiting for a reply. {formatDuration(left)} left before you can take it back.</p>
      )}

      {view === 'sent' && pending && !open && (
        <div className="mt-4 space-y-2">
          <p className="muted text-sm">No reply in time. Your STX is yours to take back.</p>
          <button
            className="btn"
            disabled={busy}
            onClick={() => reclaim.run(() => callDeny('reclaim', [Cl.uint(letter.id)], pays))}
          >
            Take back {formatStx(letter.paid)} STX
          </button>
          <TxNote state={reclaim.state} link={reclaim.link} />
        </div>
      )}
    </article>
  );
}
