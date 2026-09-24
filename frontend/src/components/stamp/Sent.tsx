"use client";
import { BOX_SENT } from '@/lib/stamp';
import { useBox, useNow } from '@/lib/useStampData';
import { LetterCard } from './LetterCard';

export function Sent({ me, onWrite }: { me: string | null; onWrite: () => void }) {
  const box = useBox(me, BOX_SENT);
  const now = useNow();

  if (!me) return <p className="muted">Connect your wallet to see the letters you sent.</p>;

  return (
    <section className="space-y-4">
      {box.error && <p style={{ color: 'var(--red)' }}>Could not load letters ({box.error}).</p>}
      {!box.loaded && !box.error && <p className="muted">Loading your letters…</p>}
      {box.loaded && box.letters.length === 0 && (
        <p className="muted">
          You haven&apos;t sent any letters.{' '}
          <button className="link" onClick={onWrite}>
            Write one
          </button>
        </p>
      )}
      {box.letters.map(letter => (
        <LetterCard
          key={letter.id.toString()}
          letter={letter}
          view="sent"
          now={now}
          onSettled={() => void box.refresh()}
        />
      ))}
      {box.hasOlder && (
        <button className="btn btn-quiet" onClick={() => void box.loadOlder()}>
          Show older letters
        </button>
      )}
    </section>
  );
}
