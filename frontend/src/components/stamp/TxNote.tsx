import type { TxState } from '@/lib/useTx';

const TEXT: Record<string, string> = {
  signing: 'Confirm in your wallet.',
  pending: 'Sent to the network. Waiting for a block.',
  success: 'Confirmed.',
};

export function TxNote({ state, link }: { state: TxState; link: string | null }) {
  if (state.phase === 'idle') return null;
  const failed = state.phase === 'failed';
  return (
    <p className="text-sm" role="status" style={{ color: failed ? 'var(--red)' : 'var(--ink-soft)' }}>
      {failed ? state.message : TEXT[state.phase]}{' '}
      {link && (
        <a className="link" href={link} target="_blank" rel="noreferrer">
          View transaction
        </a>
      )}
    </p>
  );
}
