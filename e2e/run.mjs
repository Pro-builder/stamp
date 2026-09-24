// End to end run of the Stamp UI against the live testnet contract.
// A tiny injected wallet signs with throwaway testnet keys instead of an extension.
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { Cl, makeContractCall, broadcastTransaction } from '@stacks/transactions';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
// Key files are the JSON printed by `npx @stacks/cli make_keychain -t`. Keep them outside the repo.
const load = path => JSON.parse(readFileSync(path, 'utf8')).keyInfo;
const keys = process.env.KEYS_DIR ?? `${process.env.HOME}/.stacks-keys`;
const owner = load(process.env.OWNER_KEY ?? `${keys}/stamp-deployer.json`);
const sender = load(process.env.SENDER_KEY ?? `${keys}/stamp-sender.json`);
const steps = (process.env.STEPS ?? 'open,send,reply,decline').split(',');
const walletLog = [];

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true });

async function asUser(key, viewport = { width: 1100, height: 900 }) {
  const context = await browser.newContext({ viewport, colorScheme: process.env.SCHEME ?? 'light' });
  const session = Buffer.from(JSON.stringify({ addresses: { stx: [{ address: key.address }], btc: [] } })).toString('hex');
  await context.addInitScript(
    ([address, session]) => {
      localStorage.setItem('STX_PROVIDER', 'TestWallet');
      localStorage.setItem('@stacks/connect', session);
      localStorage.setItem('stx-address', JSON.stringify(address));
      window.TestWallet = {
        request: async (method, params) => {
          const result = await window.__sign(method, JSON.stringify(params ?? {}));
          return { jsonrpc: '2.0', id: '1', result };
        },
      };
    },
    [key.address, session],
  );
  await context.exposeFunction('__sign', async (method, raw) => {
    const params = JSON.parse(raw);
    if (method !== 'stx_callContract') throw new Error(`test wallet does not support ${method}`);
    const [contractAddress, contractName] = params.contract.split('.');
    const tx = await makeContractCall({
      contractAddress,
      contractName,
      functionName: params.functionName,
      functionArgs: params.functionArgs.map(h => Cl.deserialize(h)),
      postConditions: params.postConditions ?? [],
      postConditionMode: params.postConditionMode,
      senderKey: key.privateKey,
      network: 'testnet',
    });
    const res = await broadcastTransaction({ transaction: tx, network: 'testnet' });
    if (!res.txid || res.error) throw new Error(`broadcast failed: ${JSON.stringify(res)}`);
    const entry = {
      who: key.address,
      fn: params.functionName,
      mode: params.postConditionMode,
      postConditions: (params.postConditions ?? []).length,
      txid: res.txid,
    };
    walletLog.push(entry);
    console.log('  wallet signed', entry);
    return { txid: res.txid };
  });
  const page = await context.newPage();
  page.on('pageerror', e => console.log('  page error:', e.message));
  page.on('console', m => m.type() === 'error' && console.log('  console error:', m.text().slice(0, 200)));
  return page;
}

const confirmed = async (page, scope = page) => {
  await scope.getByText('Confirmed.').first().waitFor({ timeout: 360_000 });
};

const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true });

const ownerPage = await asUser(owner);
const senderPage = await asUser(sender);

if (steps.includes('open')) {
  console.log('open inbox as owner');
  await ownerPage.goto(`${BASE}/?tab=inbox`);
  await ownerPage.getByRole('heading', { name: 'Open your inbox' }).waitFor();
  await shot(ownerPage, '01-open-form');
  await ownerPage.getByLabel('Price per letter, in STX').fill('0.5');
  await ownerPage.getByLabel('You reply within').selectOption('300');
  await ownerPage.getByRole('button', { name: 'Open inbox' }).click();
  await confirmed(ownerPage);
  await ownerPage.getByText('received,').waitFor({ timeout: 60_000 });
  await shot(ownerPage, '02-inbox-open');
}

async function sendLetter(text) {
  await senderPage.goto(`${BASE}/?to=${owner.address}`);
  await senderPage.getByLabel('Your letter').waitFor({ timeout: 60_000 });
  await senderPage.getByLabel('Your letter').fill(text);
  await senderPage.getByRole('button', { name: /^Send for/ }).click();
  await confirmed(senderPage);
}

if (steps.includes('send')) {
  console.log('send letter as sender');
  await senderPage.goto(`${BASE}/?to=${owner.address}`);
  await senderPage.getByLabel('Your letter').waitFor({ timeout: 60_000 });
  await shot(senderPage, '03-write');
  await sendLetter('Hi! I built a Clarity contract for a paid inbox and would love 5 minutes of your eyes on the reply flow. 🙏');
  await shot(senderPage, '04-sent-confirmed');
}

if (steps.includes('reply')) {
  console.log('reply as owner');
  await ownerPage.goto(`${BASE}/?tab=inbox`);
  const box = ownerPage.getByLabel('Your reply').first();
  await box.waitFor({ timeout: 60_000 });
  await shot(ownerPage, '05-inbox-letter');
  await box.fill('Looks clean. Ship it, then add encrypted letters next.');
  await ownerPage.getByRole('button', { name: /^Reply and collect/ }).first().click();
  await confirmed(ownerPage);
  await ownerPage.waitForTimeout(3000);
  await shot(ownerPage, '06-replied');
}

if (steps.includes('decline')) {
  console.log('send a second letter, then decline it');
  await sendLetter('Can you promote my token launch? Big gains guaranteed.');
  await ownerPage.goto(`${BASE}/?tab=inbox`);
  await ownerPage.getByRole('button', { name: 'Decline and refund' }).first().waitFor({ timeout: 60_000 });
  await ownerPage.getByRole('button', { name: 'Decline and refund' }).first().click();
  await confirmed(ownerPage);
  await ownerPage.waitForTimeout(3000);
  await shot(ownerPage, '07-declined');
}

if (steps.includes('late')) {
  console.log('send a letter to be reclaimed later');
  await sendLetter('Quick question about your stacks talk, whenever you have time.');
  await senderPage.goto(`${BASE}/?tab=sent`);
  await senderPage.getByText('Waiting for a reply').first().waitFor({ timeout: 60_000 });
  await shot(senderPage, '08-sent-waiting');
}

if (steps.includes('reclaim')) {
  console.log('reclaim as sender');
  await senderPage.goto(`${BASE}/?tab=sent`);
  const take = senderPage.getByRole('button', { name: /^Take back/ }).first();
  await take.waitFor({ timeout: 60_000 });
  await take.click();
  await confirmed(senderPage);
  await senderPage.waitForTimeout(3000);
  await shot(senderPage, '09-reclaimed');
}

if (steps.includes('close')) {
  console.log('close, check the write page, reopen, change price');
  await ownerPage.goto(`${BASE}/?tab=inbox`);
  await ownerPage.getByRole('button', { name: 'Close inbox' }).click();
  await confirmed(ownerPage);
  await ownerPage.getByRole('button', { name: 'Reopen inbox' }).waitFor({ timeout: 60_000 });
  await senderPage.goto(`${BASE}/?to=${owner.address}`);
  await senderPage.getByText('This inbox is closed to new letters.').waitFor({ timeout: 60_000 });
  await shot(senderPage, '12-closed');
  await ownerPage.getByRole('button', { name: 'Reopen inbox' }).click();
  await confirmed(ownerPage);
  await ownerPage.getByRole('button', { name: 'Close inbox' }).waitFor({ timeout: 60_000 });
  await ownerPage.getByRole('button', { name: 'Change price or reply time' }).click();
  await ownerPage.getByLabel('Price per letter, in STX').fill('1');
  await ownerPage.getByLabel('You reply within').selectOption('3600');
  await ownerPage.getByRole('button', { name: 'Save changes' }).click();
  await ownerPage.getByText('Reply within 1h').waitFor({ timeout: 360_000 });
  await shot(ownerPage, '13-new-price');
}

if (steps.includes('mobile')) {
  const phone = await asUser(owner, { width: 390, height: 844 });
  await phone.goto(`${BASE}/?tab=inbox`);
  await phone.getByText('received,').waitFor({ timeout: 60_000 });
  await phone.waitForTimeout(1500);
  await shot(phone, `10-mobile-inbox-${process.env.SCHEME ?? 'light'}`);
  await phone.goto(`${BASE}/`);
  await phone.waitForTimeout(1500);
  await shot(phone, `11-mobile-home-${process.env.SCHEME ?? 'light'}`);
}

console.log('wallet calls:', JSON.stringify(walletLog, null, 2));
await browser.close();
