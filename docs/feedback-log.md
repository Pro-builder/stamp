# Scaffold Stacks feedback log

Running notes kept while building Stamp, for the Scaffold Stacks test flight bounty.
Tool versions: stacksdapp 0.2.2, Clarinet 3.24.0, Node 25.8.1, Rust 1.94.1, Linux.
All times are 2026-09-23 (UTC) unless noted.

The goal of this log is to stress test the tool, so it covers paths the first build
(Agent Leash) did not touch: `stacksdapp add`, removing the template contract,
`string-utf8` arguments, read-only functions returning lists of tuples, and paging.

## Summary

What worked: `new`, `add`, `test`, `generate` and `deploy --wait-confirm` all worked first time, and deploy to confirmed on testnet took 17 seconds. The bundled agent skill (via `AGENTS.md`) was genuinely useful for an AI agent. Generated read hooks and the debug page worked for a contract with tuples, lists, optionals and `string-utf8`.

What did not, most important first:

1. `stacksdapp check` can hang forever on a hidden Clarinet `Overwrite? [Y/n]` prompt, with no `--yes` flag. Silent for agents and CI.
2. A fresh `stacksdapp new` project cannot `next build` until `generate` has been run, and `stacksdapp add` writes a 0 byte `deployments.json` that also breaks `next build`. Both are hidden until you build before deploying.
3. Generated calls always use `postConditionMode: 'allow'`, even when post conditions are passed. Deny mode needs hand written wallet calls.
4. Generated functions take untyped `ClarityValue[]` and return `any`, and read results come back as a mix of plain values and `cvToJSON` shapes.
5. The skill's Clarity cheat sheet shows `as-contract`, which does not exist in Clarity 6, the project default.

Time: scaffold at 22:39 UTC, contract deployed and confirmed at 22:51, whole UI tested end to end on testnet by 23:10, production build and write up by about 23:40. Roughly one hour of work, most of it on the frontend.

## Setup

- `stacksdapp doctor` passed with Clarinet 3.24.0. Clean output.
- `stacksdapp new stamp` scaffolded, installed dependencies and made the first git commit in 54 seconds. Worked first time.
- `stacksdapp new` does not run `generate`, so `frontend/src/generated/` does not exist yet, but the template imports from it (`components/debug/DebugContracts.tsx` re-exports `@/generated/DebugContracts`). Checked in a throwaway project: `npm run build` right after `new` fails with `Can't resolve '@/generated/DebugContracts'`. It builds after `stacksdapp generate`. Vercel does not run `generate`, so the generated files must be committed, and nothing tells you that.
- The first commit also leaves `contracts/deployments/default.simnet-plan.yaml` untracked, so the tree is dirty right after `new`.
- `frontend/` ships two env examples with different content: `.env.local.example` and `env.local.example`. Both mention `DEPLOYER_PRIVATE_KEY` in `.env.local` for testnet deploys, while `AGENTS.md`, the skill and the CLI output all say to put a mnemonic in `contracts/settings/Testnet.toml`. It is not clear which one the deploy command reads, or which wins if both are set.

## Agent skill

- `AGENTS.md` tells non Cursor agents to read `.cursor/skills/scaffold-stacks/SKILL.md` first. That worked well for Claude Code: the skill is short, links out to focused files, and the command decision tree is useful.
- `clarity-language.md` lists `as-contract` under built in context, but the project default is Clarity 6, where contracts send funds with `as-contract?` plus an allowance such as `with-stx`. An agent following the cheat sheet will write code that does not compile on the default version. The Clarity 6 features (`as-contract?`, `current-contract`, `stacks-block-time`) are not mentioned anywhere in the skill.
- `frontend.md` says read-only uint results are "typically a cvToJSON-shaped object" like `{ type: "uint", value: "1500000" }`. In Agent Leash, top level uints came back as plain `bigint` and only nested values had the `{ type, value }` shape. The helper in the doc handles both, but the text sets the wrong expectation.

## Contract work

- `stacksdapp add inbox` created the contract, a matching test stub, the `Clarinet.toml` entry with Clarity 6 and epoch 4.0, and regenerated bindings in under 3 seconds. Good experience.
- The "Next" hint after `add` jumps straight to `stacksdapp deploy --network testnet`, skipping `check`, `test` and setting the mnemonic, which the rest of the docs insist on.
- Removing the template `counter` contract (deleting the file, its test and its `Clarinet.toml` entry) is not covered by any command. There is `add` but no `remove`.
- **Biggest issue so far:** after removing `counter`, `stacksdapp check` hung for 5 minutes until it was killed. Clarinet had printed a long diff of the simnet deployment plan and was waiting on `Overwrite? [Y/n]`, buried under the diff. `stacksdapp check` gives no way to answer that (no `--yes` flag), and the prompt appeared even though stdin was not a terminal. For an AI agent or a CI job this is a silent hang. Running `stacksdapp check < /dev/null` works around it: Clarinet takes the default and continues. The skill says to use `--yes` for non interactive use, but only `deploy` has it.
- The prompt also showed that the plan kept on disk by `new` still differs from the computed one (`costs-5` is in one and not the other), so the first `check` after `new` can hit the same prompt even without removing anything.
- After the fix, `check` ran cleanly with zero warnings on a 350 line contract. Agent Leash got 14 "potentially unchecked data" warnings for similar code, so this is inconsistent, but welcome.
- The `check_checker` pass flagged `unwrap-panic` on two lines that could never fail. The hint was clear and the rewrite with `default-to` was easy.

## Tests

- `stacksdapp test` ran 27 contract tests in about 7 seconds. `simnet.mineEmptyBlocks` moves `stacks-block-time` forward (about 600 seconds per block), which made the deadline tests simple.
- `string-utf8` arguments with emoji and Chinese text round tripped correctly through `Cl.stringUtf8` in simnet.
- Breaking three checks on purpose (recipient check, deadline check, expected price check) made exactly the matching test fail each time.
- Vitest prints a deprecation warning from the Clarinet environment on every run ("transformMode ... deprecated in Vitest 4"). Harmless, but it is the first thing a new user sees in test output.
- `stacksdapp test` also runs frontend vitest, which finds no test files and passes. Fine, but the template ships no example frontend test to build on.

## Code generation

- After removing `counter`, `stacksdapp generate` dropped every counter hook and function cleanly. No stale code left behind.
- The generated functions are not typed per contract function. `inbox_sendMessage(functionArgs: ClarityValue[], postConditions: any[])` does not say it needs a principal, a `string-utf8` and a uint, so passing the wrong arguments only fails in the wallet or on chain. The ABI has this information, so typed signatures (or a typed args object) would catch mistakes at compile time. Return types are `any` and `unknown`.
- `contracts.ts` accepts post conditions but still hardcodes `postConditionMode: 'allow'`, so passing post conditions only checks the transfers you list and lets any others through. There is no way to get `deny` mode without writing your own `request('stx_callContract')` call. (The devnet path uses deny, so devnet and testnet behave differently.)
- Read-only hooks include the full transaction polling effect (about 100 lines each) even though `isReadOnly` is a constant `true` and it can never run. `hooks.ts` is 1614 lines for 11 functions.
- `stacksdapp add` left `frontend/src/generated/deployments.json` as an empty 0 byte file. With that file, `next build` fails: `Module parse failed: Cannot parse JSON: Unexpected end of JSON input`. The `try { require(...) }` in the generated `contracts.ts` does not help, because webpack parses the JSON at build time. `stacksdapp generate` on its own writes a valid placeholder (`{ "network": "", "deployed_at": "", "contracts": {} }`), so `add` should do the same. Deploying fixes it too, which hides the problem until someone builds before deploying.

## Deploy

- Funding the new deployer through the Hiro faucet API worked instantly (500 testnet STX).
- `stacksdapp deploy --network testnet --dry-run --yes` gave a clear plan and fee estimate (0.61 STX).
- `stacksdapp deploy --network testnet --yes --wait-confirm` deployed and confirmed in 17 seconds, then regenerated bindings and wrote `deployments.json`. Worked first time.
- With `--wait-confirm`, `deployments.json` still records `"block_height": 0`, although the transaction was confirmed in block 519764. The flag waited for the block, so it could record it.
- When output is not a terminal (agent, CI, piped to a file), the spinners are still drawn, so the log fills with hundreds of repeated `⠋ Checking existing contracts...` frames. Detecting a non TTY and printing one line per step would keep logs readable.
- `stacksdapp dev --network testnet` switched `frontend/.env.local` from devnet to testnet and started Next.js on port 3000. It worked, but `deploy --network testnet` had already finished without touching `.env.local`, so running `npm run dev` directly after a deploy still points the app at devnet.

## Frontend

- Read hooks worked well for this contract once unwrapped. `get-page` returns a tuple holding a list of tuples with `string-utf8`, `optional` and `principal` fields, and `cvToValue` gives a mix of shapes: the outer tuple is a plain object, but every value inside is a `cvToJSON` object with string numbers (`{ type: "uint", value: "12" }`). A small recursive `plain()` helper turned it into normal values. The generated code could return typed plain objects directly, since it knows the ABI.
- Every write that moves STX (`send-message`, `reply`, `decline`, `reclaim`) had to bypass the generated code with a hand written `request('stx_callContract')` call, only to set `postConditionMode: 'deny'`. The two writes that move no funds (`open-inbox`, `close-inbox`) use the generated hooks as is, and the hooks' built in tx polling and `explorerUrl` worked well there.
- The generated `DebugContracts.tsx` imports `@/components/Message`, a template component you would expect to be free to delete or restyle. Deleting it breaks generated code.
- The template's `WalletConnect.tsx` is styled with hardcoded dark colors (`bg-[#434242]` and similar), and `layout.tsx` hardcodes the `#131416` background on `<html>` and `<body>`. Restyling the app meant editing all of them. CSS variables in `globals.css` would make the template easier to theme.
- `@stacks/connect` stores the chosen wallet under the `STX_PROVIDER` localStorage key and calls `window[id].request(...)`. That made it possible to run the real UI end to end in headless Chrome with a small test wallet that signs with throwaway keys. Every public function was exercised on testnet through the UI this way: open, send, reply, decline, reclaim after the window, close, reopen and change price. The template has no guidance on testing the frontend against a contract; a documented test wallet like this would fill that gap.
- `next build` passed with one warning that comes from `@stacks/connect` pulling in `viem` through WalletConnect, not from the template.
- `npm run typecheck` passed before any `next dev` or `next build` had run. The Agent Leash problem (missing `next-env.d.ts`) came from the template `Header.tsx` importing a png, which Stamp no longer does.

## Time

- Scaffold to 27 passing tests: about 10 minutes
- Scaffold to contract confirmed on testnet: 12 minutes
- Scaffold to every contract function exercised through the UI on testnet: about 31 minutes
- Scaffold to production build, README and this log: about one hour
