"use client";
import { useEffect, useRef, useState } from 'react';
import { Cl } from '@stacks/transactions';
import { useInbox_CloseInbox, useInbox_OpenInbox } from '@/generated/hooks';
import { BOX_INBOX, explainError, formatStx, parseStx, type Inbox } from '@/lib/stamp';
import { useBox, useInboxOf, useNow } from '@/lib/useStampData';
import { LetterCard } from './LetterCard';
import { StampMark } from './StampMark';

const WINDOWS = [
  { label: '5 minutes', seconds: 300 },
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86400 },
  { label: '3 days', seconds: 259200 },
  { label: '1 week', seconds: 604800 },
];

type WriteHook = ReturnType<typeof useInbox_OpenInbox>;

function HookStatus({ hook }: { hook: WriteHook }) {
  if (hook.error) return <p className="text-sm" style={{ color: 'var(--red)' }}>{hook.error.message}</p>;
  if (!hook.txStatus) return null;
  const failed = hook.txStatus === 'abort_by_response' || hook.txStatus === 'error';
  return (
    <p className="text-sm" style={{ color: failed ? 'var(--red)' : 'var(--ink-soft)' }}>
      {hook.txStatus === 'pending' && 'Waiting for a block.'}
      {hook.txStatus === 'success' && 'Confirmed.'}
      {failed && explainError(hook.txStatusError ?? 'The transaction failed.')}{' '}
      {hook.explorerUrl && (
        <a className="link" href={hook.explorerUrl} target="_blank" rel="noreferrer">
          View transaction
        </a>
      )}
    </p>
  );
}

function Settings({ inbox, onDone }: { inbox: Inbox | null; onDone: () => void }) {
  const openHook = useInbox_OpenInbox();
  const [price, setPrice] = useState(inbox ? formatStx(inbox.price) : '1');
  const [replyWindow, setReplyWindow] = useState(inbox ? Number(inbox.window) : 3600);
  const micro = parseStx(price);
  const busy = openHook.loading || openHook.txStatus === 'pending';
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (openHook.txStatus === 'success') done.current();
  }, [openHook.txStatus]);

  const windows = WINDOWS.some(w => w.seconds === replyWindow)
    ? WINDOWS
    : [...WINDOWS, { label: `${replyWindow} seconds`, seconds: replyWindow }];

  return (
    <form
      className="sheet space-y-4"
      onSubmit={e => {
        e.preventDefault();
        if (micro && micro > 0n) void openHook.call([Cl.uint(micro), Cl.uint(replyWindow)]).catch(() => {});
      }}
    >
      <h2 className="text-xl font-bold">{inbox ? 'Change your stamp' : 'Open your inbox'}</h2>
      {!inbox && (
        <p style={{ color: 'var(--ink-soft)' }}>
          Pick what a letter to you costs and how long you take to reply. You earn the STX on every letter you
          answer in time. Letters you decline or miss go back to the sender.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm font-semibold">Price per letter, in STX</span>
          <input className="field" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} />
          {!micro && <span className="text-sm" style={{ color: 'var(--red)' }}>Enter an amount like 1 or 0.5</span>}
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold">You reply within</span>
          <select className="field" value={replyWindow} onChange={e => setReplyWindow(Number(e.target.value))}>
            {windows.map(w => (
              <option key={w.seconds} value={w.seconds}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="btn" disabled={busy || !micro || micro === 0n}>
        {inbox ? 'Save changes' : 'Open inbox'}
      </button>
      <HookStatus hook={openHook} />
    </form>
  );
}

export function MyInbox({ me }: { me: string | null }) {
  const { inbox, loaded, error, refresh } = useInboxOf(me);
  const box = useBox(me, BOX_INBOX);
  const closeHook = useInbox_CloseInbox();
  const reopenHook = useInbox_OpenInbox();
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const now = useNow();

  useEffect(() => {
    if (closeHook.txStatus === 'success' || reopenHook.txStatus === 'success') void refresh();
  }, [closeHook.txStatus, reopenHook.txStatus, refresh]);

  if (!me) return <p className="muted">Connect your wallet to see your inbox.</p>;
  if (error) return <p style={{ color: 'var(--red)' }}>Could not reach the Stacks API ({error}).</p>;
  if (!loaded) return <p className="muted">Loading your inbox…</p>;

  if (!inbox) return <Settings inbox={null} onDone={refresh} />;

  const link = typeof location === 'undefined' ? '' : `${location.origin}/?to=${me}`;
  const toggling = closeHook.loading || reopenHook.loading || closeHook.txStatus === 'pending' || reopenHook.txStatus === 'pending';

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-center gap-6">
        <StampMark price={inbox.price} window={inbox.window} open={inbox.open} />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-lg">
            <strong>{inbox.received.toString()}</strong> received, <strong>{inbox.replied.toString()}</strong> replied,{' '}
            <strong>{formatStx(inbox.earned)} STX</strong> earned
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <button className="link" onClick={() => setEditing(v => !v)}>
              {editing ? 'Cancel' : 'Change price or reply time'}
            </button>
            {inbox.open ? (
              <button className="link" disabled={toggling} onClick={() => void closeHook.call([]).catch(() => {})}>
                Close inbox
              </button>
            ) : (
              <button
                className="link"
                disabled={toggling}
                onClick={() => void reopenHook.call([Cl.uint(inbox.price), Cl.uint(inbox.window)]).catch(() => {})}
              >
                Reopen inbox
              </button>
            )}
          </div>
          <HookStatus hook={closeHook} />
          <HookStatus hook={reopenHook} />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="share" className="block text-sm font-semibold">
          Your inbox link
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input id="share" className="field text-sm" readOnly value={link} onFocus={e => e.target.select()} />
          <button
            className="btn btn-quiet shrink-0"
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>

      {editing && (
        <Settings
          inbox={inbox}
          onDone={() => {
            setEditing(false);
            void refresh();
          }}
        />
      )}

      <div className="space-y-4">
        <h2 className="text-xl font-bold">Letters</h2>
        {box.error && <p style={{ color: 'var(--red)' }}>Could not load letters ({box.error}).</p>}
        {box.loaded && box.letters.length === 0 && (
          <p className="muted">No letters yet. Share your link to get your first one.</p>
        )}
        {box.letters.map(letter => (
          <LetterCard
            key={letter.id.toString()}
            letter={letter}
            view="inbox"
            now={now}
            onSettled={() => {
              void box.refresh();
              void refresh();
            }}
          />
        ))}
        {box.hasOlder && (
          <button className="btn btn-quiet" onClick={() => void box.loadOlder()}>
            Show older letters
          </button>
        )}
      </div>
    </section>
  );
}
