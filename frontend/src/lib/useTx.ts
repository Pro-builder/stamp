"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { explainError, explorerTx, waitForTx } from './stamp';

export type TxState =
  | { phase: 'idle' }
  | { phase: 'signing' }
  | { phase: 'pending'; txid: string }
  | { phase: 'success'; txid: string }
  | { phase: 'failed'; message: string; txid?: string };

/** Runs a wallet call, then follows the transaction until it settles. */
export function useTx(onSuccess?: () => void) {
  const [state, setState] = useState<TxState>({ phase: 'idle' });
  const mounted = useRef(true);
  const success = useRef(onSuccess);
  success.current = onSuccess;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (send: () => Promise<string | null | undefined>) => {
    setState({ phase: 'signing' });
    let txid: string | null | undefined;
    try {
      txid = await send();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (mounted.current) setState({ phase: 'failed', message: /cancel|reject|denied/i.test(message) ? 'You cancelled the request in your wallet.' : message });
      return;
    }
    if (!txid) {
      if (mounted.current) setState({ phase: 'failed', message: 'The wallet did not return a transaction.' });
      return;
    }
    if (mounted.current) setState({ phase: 'pending', txid });
    const done = await waitForTx(txid);
    if (!mounted.current) return;
    if (done.status === 'success') {
      setState({ phase: 'success', txid });
      success.current?.();
      // The read node can lag the tx API by a moment, so refresh once more.
      setTimeout(() => success.current?.(), 4000);
    } else {
      setState({ phase: 'failed', message: explainError(done.repr), txid });
    }
  }, []);

  const reset = useCallback(() => setState({ phase: 'idle' }), []);
  const busy = state.phase === 'signing' || state.phase === 'pending';
  const link = 'txid' in state && state.txid ? explorerTx(state.txid) : null;

  return { state, busy, link, run, reset };
}
