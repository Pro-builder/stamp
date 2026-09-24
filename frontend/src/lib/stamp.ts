import { request } from '@stacks/connect';
import { Pc, type ClarityValue, type PostCondition } from '@stacks/transactions';
import { scaffoldConfig } from '@/scaffold.config';
import deployments from '@/generated/deployments.json';

export const CONTRACT_ID: string =
  (deployments as { contracts?: Record<string, { contract_id?: string }> }).contracts?.inbox?.contract_id ?? '';

export const BOX_INBOX = 0;
export const BOX_SENT = 1;
export const PAGE_SIZE = 10;
export const MAX_CHARS = 280;

export const STATUS = { pending: 0, replied: 1, declined: 2, reclaimed: 3 } as const;

export type Inbox = {
  price: bigint;
  window: bigint;
  open: boolean;
  received: bigint;
  replied: bigint;
  earned: bigint;
};

export type Letter = {
  id: bigint;
  from: string;
  to: string;
  body: string;
  paid: bigint;
  sentAt: bigint;
  deadline: bigint;
  status: number;
  reply: string | null;
};

type Json = { type: string; value: unknown };

function isJson(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && 'type' in v && 'value' in v;
}

/**
 * Read hooks return cvToValue output: top level uints are bigint, but anything
 * inside a tuple, list or optional is a cvToJSON `{ type, value }` object with
 * string numbers. This flattens both into plain values.
 */
export function plain(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(plain);
  if (isJson(v)) {
    if (v.type === 'uint' || v.type === 'int') return BigInt(String(v.value));
    if (v.type.startsWith('(optional')) return plain(v.value);
    if (v.type.startsWith('(list')) return (v.value as unknown[]).map(plain);
    if (v.type.startsWith('(tuple')) return plain(v.value);
    return v.value;
  }
  if (typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plain(x)]));
  }
  return v;
}

export function toInbox(raw: unknown): Inbox | null {
  const v = plain(raw) as Record<string, unknown> | null;
  if (!v) return null;
  return {
    price: v.price as bigint,
    window: v.window as bigint,
    open: v.open as boolean,
    received: v.received as bigint,
    replied: v.replied as bigint,
    earned: v.earned as bigint,
  };
}

export function toLetter(v: Record<string, unknown>): Letter {
  return {
    id: v.id as bigint,
    from: v.from as string,
    to: v.to as string,
    body: v.body as string,
    paid: v.paid as bigint,
    sentAt: v['sent-at'] as bigint,
    deadline: v.deadline as bigint,
    status: Number(v.status),
    reply: (v.reply as string | null) ?? null,
  };
}

export function toPage(raw: unknown): { total: number; letters: Letter[] } {
  const v = plain(raw) as { total?: bigint; messages?: Record<string, unknown>[] } | null;
  return {
    total: Number(v?.total ?? 0n),
    letters: (v?.messages ?? []).map(toLetter),
  };
}

export function isPrincipal(addr: string | null | undefined): addr is string {
  return typeof addr === 'string' && /^(ST|SP)[0-9A-HJ-NP-Z]{38,41}$/.test(addr);
}

export function charCount(text: string) {
  return [...text].length;
}

export function formatStx(micro: bigint) {
  const whole = micro / 1_000_000n;
  const fraction = (micro % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function parseStx(input: string): bigint | null {
  const match = input.trim().match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) return null;
  return BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0'));
}

export function shortAddress(addr: string) {
  return `${addr.slice(0, 5)}…${addr.slice(-4)}`;
}

export function formatDuration(seconds: number) {
  if (seconds <= 0) return 'now';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function explorerTx(txid: string) {
  const id = txid.startsWith('0x') ? txid : `0x${txid}`;
  return `${scaffoldConfig.explorerBaseUrl}${id}${scaffoldConfig.explorerChainQuery}`;
}

export function explorerAddress(addr: string) {
  return `https://explorer.hiro.so/address/${addr}${scaffoldConfig.explorerChainQuery}`;
}

export const senderPays = (sender: string, amount: bigint): PostCondition =>
  Pc.principal(sender).willSendEq(amount).ustx();

export const contractPays = (amount: bigint): PostCondition =>
  Pc.principal(CONTRACT_ID).willSendEq(amount).ustx();

/**
 * The generated contract functions always use postConditionMode 'allow', so
 * calls that move STX go through here with 'deny' instead.
 */
export async function callDeny(functionName: string, functionArgs: ClarityValue[], postConditions: PostCondition[]) {
  const result = await request('stx_callContract', {
    contract: CONTRACT_ID as `${string}.${string}`,
    functionName,
    functionArgs,
    postConditions,
    postConditionMode: 'deny',
    network: scaffoldConfig.targetNetwork,
  });
  return result?.txid ?? null;
}

export type TxStatus = 'pending' | 'success' | 'failed';

export async function waitForTx(txid: string): Promise<{ status: TxStatus; repr: string }> {
  const id = txid.startsWith('0x') ? txid : `0x${txid}`;
  const headers: Record<string, string> = scaffoldConfig.hiroApiKey ? { 'x-api-key': scaffoldConfig.hiroApiKey } : {};
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 2000 : 3000));
    try {
      const res = await fetch(`${scaffoldConfig.nodeUrl}/extended/v1/tx/${id}`, { headers, cache: 'no-store' });
      if (!res.ok) continue;
      const tx = await res.json();
      if (tx.tx_status === 'success') return { status: 'success', repr: tx.tx_result?.repr ?? '' };
      if (tx.tx_status && tx.tx_status !== 'pending') return { status: 'failed', repr: tx.tx_result?.repr ?? tx.tx_status };
    } catch {
      // keep polling through network hiccups
    }
  }
  return { status: 'failed', repr: 'Timed out waiting for the transaction.' };
}

const ERRORS: Record<string, string> = {
  u100: 'This address has not opened an inbox yet.',
  u101: 'This inbox is closed to new messages.',
  u102: 'You cannot send a message to yourself.',
  u103: 'The price changed while you were writing. Reload and try again.',
  u104: 'The message is empty.',
  u105: 'That message does not exist.',
  u106: 'Only the person who received this message can do that.',
  u107: 'Only the sender can take this payment back.',
  u108: 'This message is already settled.',
  u109: 'The reply window has closed.',
  u110: 'The reply window is still open.',
  u111: 'The price must be more than 0 STX.',
  u112: 'The reply window must be between 1 minute and 30 days.',
};

export function explainError(repr: string) {
  const code = repr.match(/u1\d\d/)?.[0];
  return (code && ERRORS[code]) || repr;
}
