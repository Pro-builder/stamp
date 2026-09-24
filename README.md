# Stamp

A paid inbox on Stacks. Put STX on a message to get someone's attention. They earn it by replying in time, and you get it back if they decline or never answer.

Built with [Scaffold Stacks](https://scaffoldstacks.mintlify.app/) for the Scaffold Stacks test flight bounty. The honest notes on the tool are in [docs/feedback-log.md](docs/feedback-log.md).

- Contract (testnet): [`STP4136HTFB6KT53SE393QP4RZDN1715T4988JFF.inbox`](https://explorer.hiro.so/txid/0xd8435f7937d459843b6b5a022d332514cf2ea33b0a49fc0ffe9381fe3b4ce709?chain=testnet)
- Live app: _add the Vercel link here_

## How it works

1. Anyone opens an inbox with a price per letter and a reply window (1 minute to 30 days).
2. A sender pays the price to send a letter of up to 280 characters. The STX waits in the contract.
3. The owner can **reply** before the window closes and collect the STX, or **decline** and refund the sender right away.
4. If the window passes with no reply, the sender can **take the STX back**.

Paying only for a reply keeps the incentives honest: spammers have to lock real money to reach you, senders never pay for silence, and owners are paid for their time rather than for ignoring people.

## Real testnet transactions

Every public function was run through the UI on testnet:

| Action | Transaction |
|---|---|
| Send a letter | [dee64aaa…](https://explorer.hiro.so/txid/0xdee64aaabae0a69cf16e3c99c757cdd65ce8390658f5d61260f7855a7f58f883?chain=testnet) |
| Reply and collect | [c88b16e2…](https://explorer.hiro.so/txid/0xc88b16e2442f1f346ea13cc99e9fac4b74a8a1bda63b2c7570ff68d65c71651b?chain=testnet) |
| Decline and refund | [f78192f5…](https://explorer.hiro.so/txid/0xf78192f5550f203fd0c01d4df4ad0f45cc49b88f46ec53a63fe3490871185e88?chain=testnet) |
| Take back after the window | [3735a234…](https://explorer.hiro.so/txid/0x3735a2349ce3aa02285fabcafbe83cf66ec8bb98298be75cb58da2f93d77693f?chain=testnet) |

## Design choices

- **Post conditions in deny mode.** Every call that moves STX states the exact amount, and the wallet refuses anything else. The generated Scaffold Stacks calls always use allow mode, so these go through a small `callDeny` helper in `frontend/src/lib/stamp.ts`.
- **Price check on send.** `send-message` takes the price the sender saw. If the owner changed it in the meantime, the call fails instead of charging a different amount.
- **Reply window fixed per letter.** The deadline is set when a letter is sent, so changing your reply time later never affects letters already waiting.
- **No race between reply and take back.** Replies are allowed only before the deadline and take backs only after it.
- **Paged inboxes.** Letters are indexed per owner and read 10 at a time with `get-page`, so an inbox never fills up.

**Letters and replies are public.** Everything onchain can be read by anyone, and the app says so next to the compose box. Encrypted letters would be the natural next step.

## Project layout

```
contracts/contracts/inbox.clar   the contract (Clarity 6)
contracts/tests/inbox.test.ts    27 simnet tests
frontend/src/components/stamp/   the app: Write, Inbox, Sent, letters and the stamp
frontend/src/lib/                data helpers, deny mode calls, tx tracking
frontend/src/generated/          bindings from `stacksdapp generate` (do not edit)
e2e/run.mjs                      browser test against the live testnet contract
docs/feedback-log.md             notes on Scaffold Stacks, written while building
```

## Run it

Requires `stacksdapp` 0.2.2, Clarinet 3.23 or newer, and Node 20 or newer.

```bash
stacksdapp check < /dev/null   # the < /dev/null avoids a hang, see the feedback log
stacksdapp test
stacksdapp dev --network testnet
```

Open http://localhost:3000 and connect Leather or Xverse on testnet. The debug panel for every contract function is at `/debug`.

To deploy your own copy, put a testnet mnemonic in `contracts/settings/Testnet.toml`, run `stacksdapp deploy --network testnet --yes`, then put the placeholder back before committing. The pre-commit hook blocks real seed phrases.

## End to end test

`e2e/run.mjs` drives the real UI in headless Chrome against the testnet contract. Instead of a browser extension, it injects a small test wallet that signs with throwaway testnet keys, which works because `@stacks/connect` looks up the wallet by the id stored under the `STX_PROVIDER` localStorage key.

```bash
cd e2e && npm install
# key files are the JSON from `npx @stacks/cli make_keychain -t`, funded from the testnet faucet
OWNER_KEY=owner.json SENDER_KEY=sender.json STEPS=open,send,reply,decline node run.mjs
```

Other steps: `late`, `reclaim` (after the window), `close`, `mobile`. Screenshots land in `e2e/shots/`.
