"use client";
import { useEffect, useState } from 'react';
import { Cl } from '@stacks/transactions';
import { MAX_CHARS, callDeny, charCount, formatDuration, formatStx, isPrincipal, senderPays, shortAddress } from '@/lib/stamp';
import { useInboxOf } from '@/lib/useStampData';
import { useTx } from '@/lib/useTx';
import { StampMark } from './StampMark';
import { TxNote } from './TxNote';

export function Write({
  me,
  to,
  onPickRecipient,
  onOpenInbox,
  onShowSent,
}: {
  me: string | null;
  to: string | null;
  onPickRecipient: (addr: string | null) => void;
  onOpenInbox: () => void;
  onShowSent: () => void;
}) {
  const [address, setAddress] = useState(to ?? '');
  const [body, setBody] = useState('');
  const { inbox, loaded, error, refresh } = useInboxOf(to);
  const send = useTx(() => {
    setBody('');
    void refresh();
  });

  useEffect(() => setAddress(to ?? ''), [to]);

  const count = charCount(body);
  const own = !!me && me === to;

  if (!to) {
    return (
      <section className="space-y-10">
        <div className="space-y-4">
          <h1 className="wide text-[40px] font-extrabold leading-[1.05] sm:text-[52px]">Letters worth answering.</h1>
          <p className="max-w-[52ch] text-lg" style={{ color: 'var(--ink-soft)' }}>
            Stamp is a paid inbox. Put STX on your message to get someone&apos;s attention. They earn it by replying,
            and you get it back if they don&apos;t answer in time.
          </p>
        </div>

        <form
          className="space-y-3"
          onSubmit={e => {
            e.preventDefault();
            if (isPrincipal(address.trim())) onPickRecipient(address.trim());
          }}
        >
          <label htmlFor="recipient" className="block font-semibold">
            Write to someone
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="recipient"
              className="field"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Their Stacks address, ST…"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="btn shrink-0" disabled={!isPrincipal(address.trim())}>
              Find inbox
            </button>
          </div>
          {address.trim() && !isPrincipal(address.trim()) && (
            <p className="text-sm" style={{ color: 'var(--red)' }}>
              That is not a Stacks address. It starts with ST on testnet.
            </p>
          )}
        </form>

        <p>
          Want letters of your own?{' '}
          <button className="link" onClick={onOpenInbox}>
            Open your inbox
          </button>
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <button className="link text-sm" onClick={() => onPickRecipient(null)}>
        Write to someone else
      </button>

      {!loaded && !error && <p className="muted">Looking up this inbox…</p>}
      {error && (
        <p style={{ color: 'var(--red)' }}>
          Could not reach the Stacks API ({error}).{' '}
          <button className="link" onClick={() => void refresh()}>
            Try again
          </button>
        </p>
      )}

      {loaded && !error && !inbox && (
        <div className="space-y-2">
          <h2 className="text-xl font-bold">{shortAddress(to)} has no inbox yet</h2>
          <p className="muted">They need to open one before anyone can write to them. Send them a link to Stamp.</p>
        </div>
      )}

      {inbox && (
        <>
          <div className="flex flex-wrap items-center gap-6">
            <StampMark price={inbox.price} window={inbox.window} open={inbox.open} />
            <div className="min-w-0 flex-1 space-y-2">
              <h2 className="break-all text-xl font-bold" title={to}>
                Write to {shortAddress(to)}
              </h2>
              <p style={{ color: 'var(--ink-soft)' }}>
                {inbox.open
                  ? `Costs ${formatStx(inbox.price)} STX. If they don't reply within ${formatDuration(Number(inbox.window))}, you can take it back.`
                  : 'This inbox is closed to new letters.'}
              </p>
              <p className="muted text-sm">
                Answered {inbox.replied.toString()} of {inbox.received.toString()} letters so far.
              </p>
            </div>
          </div>

          {own && (
            <p className="muted">
              This is your own inbox. Share the link so other people can write to you.
            </p>
          )}

          {inbox.open && !own && (
            <form
              className="sheet airmail space-y-3"
              onSubmit={e => {
                e.preventDefault();
                if (!me) return;
                send.run(() =>
                  callDeny(
                    'send-message',
                    [Cl.principal(to), Cl.stringUtf8(body.trim()), Cl.uint(inbox.price)],
                    [senderPays(me, inbox.price)],
                  ),
                );
              }}
            >
              <label htmlFor="letter" className="block text-sm font-semibold">
                Your letter
              </label>
              <textarea
                id="letter"
                className="field typed min-h-[160px] text-[17px] leading-relaxed"
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Say what you need and why it matters to them."
                disabled={send.busy}
              />
              <div className="flex flex-wrap items-center gap-3">
                <button className="btn" disabled={!me || send.busy || count === 0 || count > MAX_CHARS}>
                  Send for {formatStx(inbox.price)} STX
                </button>
                <span
                  className="muted ml-auto text-sm"
                  style={count > MAX_CHARS ? { color: 'var(--red)' } : undefined}
                >
                  {count} / {MAX_CHARS}
                </span>
              </div>
              {!me && <p className="muted text-sm">Connect your wallet to send.</p>}
              <p className="muted text-sm">Letters are public onchain. Don&apos;t write anything private.</p>
              <TxNote state={send.state} link={send.link} />
              {send.state.phase === 'success' && (
                <p className="text-sm">
                  Your letter is on its way.{' '}
                  <button type="button" className="link" onClick={onShowSent}>
                    Follow it in Sent
                  </button>
                </p>
              )}
            </form>
          )}
        </>
      )}
    </section>
  );
}
