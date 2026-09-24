"use client";
import { useCallback, useEffect, useState } from 'react';
import { Cl } from '@stacks/transactions';
import { useInbox_GetInbox, useInbox_GetPage } from '@/generated/hooks';
import { CONTRACT_ID, PAGE_SIZE, isPrincipal, nowSeconds, toInbox, toPage, type Inbox, type Letter } from './stamp';

function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function useInboxOf(owner: string | null) {
  const { call } = useInbox_GetInbox();
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isPrincipal(owner) || !CONTRACT_ID) return;
    try {
      setInbox(toInbox(await call([Cl.principal(owner)])));
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoaded(true);
    }
  }, [call, owner]);

  useEffect(() => {
    setInbox(null);
    setLoaded(false);
    void refresh();
  }, [refresh]);

  return { inbox, loaded, error, refresh };
}

/** Letters in one box, newest first, loaded a page at a time. */
export function useBox(owner: string | null, box: number) {
  const { call } = useInbox_GetPage();
  const [letters, setLetters] = useState<Letter[]>([]);
  const [start, setStart] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const page = useCallback(
    async (offset: number) => toPage(await call([Cl.principal(owner!), Cl.uint(box), Cl.uint(offset)])),
    [call, owner, box],
  );

  const refresh = useCallback(async () => {
    if (!isPrincipal(owner) || !CONTRACT_ID) return;
    try {
      const first = await page(0);
      if (first.total <= PAGE_SIZE) {
        setLetters([...first.letters].reverse());
        setStart(0);
      } else {
        const newest = first.total - PAGE_SIZE;
        const last = await page(newest);
        setLetters([...last.letters].reverse());
        setStart(newest);
      }
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoaded(true);
    }
  }, [owner, page]);

  const loadOlder = useCallback(async () => {
    const from = Math.max(0, start - PAGE_SIZE);
    try {
      const older = await page(from);
      setLetters(current => [...current, ...older.letters.slice(0, start - from).reverse()]);
      setStart(from);
    } catch (e) {
      setError(message(e));
    }
  }, [page, start]);

  useEffect(() => {
    setLetters([]);
    setLoaded(false);
    void refresh();
  }, [refresh]);

  return { letters, loaded, error, refresh, loadOlder, hasOlder: start > 0 };
}

export function useNow() {
  const [now, setNow] = useState(nowSeconds);
  useEffect(() => {
    const timer = setInterval(() => setNow(nowSeconds()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
