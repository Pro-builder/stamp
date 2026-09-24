"use client";
import { useCallback, useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { addressAtom, isMountedAtom } from '@/store/wallet';
import { CONTRACT_ID, isPrincipal } from '@/lib/stamp';
import { MyInbox } from './MyInbox';
import { Sent } from './Sent';
import { Write } from './Write';

type Tab = 'write' | 'inbox' | 'sent';
const TABS: { id: Tab; label: string }[] = [
  { id: 'write', label: 'Write' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'sent', label: 'Sent' },
];

function readUrl(): { tab: Tab | null; to: string | null } {
  const params = new URLSearchParams(window.location.search);
  const to = params.get('to');
  const tab = params.get('tab');
  return {
    to: isPrincipal(to) ? to : null,
    tab: tab === 'write' || tab === 'inbox' || tab === 'sent' ? tab : null,
  };
}

export function App() {
  const me = useAtomValue(addressAtom);
  const mounted = useAtomValue(isMountedAtom);
  const [tab, setTab] = useState<Tab>('write');
  const [to, setTo] = useState<string | null>(null);

  useEffect(() => {
    const url = readUrl();
    setTo(url.to);
    if (url.tab) setTab(url.tab);
  }, []);

  const go = useCallback((next: Tab, recipient: string | null = to) => {
    setTab(next);
    setTo(recipient);
    const params = new URLSearchParams();
    if (next !== 'write') params.set('tab', next);
    if (next === 'write' && recipient) params.set('to', recipient);
    const query = params.toString();
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
  }, [to]);

  if (!CONTRACT_ID) {
    return <p className="muted">The inbox contract is not deployed on this network yet.</p>;
  }

  return (
    <div className="space-y-8">
      <nav role="tablist" aria-label="Stamp" className="flex gap-6" style={{ borderBottom: '1px solid var(--rule)' }}>
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => go(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {!mounted ? null : tab === 'write' ? (
        <Write
          me={me}
          to={to}
          onPickRecipient={addr => go('write', addr)}
          onOpenInbox={() => go('inbox')}
          onShowSent={() => go('sent')}
        />
      ) : tab === 'inbox' ? (
        <MyInbox me={me} />
      ) : (
        <Sent me={me} onWrite={() => go('write', null)} />
      )}
    </div>
  );
}
