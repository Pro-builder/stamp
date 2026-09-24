import { describe, expect, it } from "vitest";
import { Cl, ClarityType, cvToValue } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const owner = accounts.get("wallet_1")!;
const sender = accounts.get("wallet_2")!;
const outsider = accounts.get("wallet_3")!;
const contract = `${deployer}.inbox`;

const PRICE = 2_000_000;
const WINDOW = 3600;

const stx = (who: string) => simnet.getAssetsMap().get("STX")?.get(who) ?? 0n;

const openInbox = (price = PRICE, window = WINDOW, who = owner) =>
  simnet.callPublicFn("inbox", "open-inbox", [Cl.uint(price), Cl.uint(window)], who);

const send = (body = "Can you review my pull request?", price = PRICE, from = sender, to = owner) =>
  simnet.callPublicFn(
    "inbox",
    "send-message",
    [Cl.principal(to), Cl.stringUtf8(body), Cl.uint(price)],
    from,
  );

const message = (id: number) => {
  const { result } = simnet.callReadOnlyFn("inbox", "get-message", [Cl.uint(id)], owner);
  return cvToValue(result) as { value: Record<string, { value: unknown }> };
};

const passWindow = () => simnet.mineEmptyBlocks(Math.ceil(WINDOW / 600) + 2);

describe("open-inbox", () => {
  it("opens an inbox with a price and window", () => {
    expect(openInbox().result).toBeOk(Cl.bool(true));
    const { result } = simnet.callReadOnlyFn("inbox", "get-inbox", [Cl.principal(owner)], owner);
    expect(result).toBeSome(
      Cl.tuple({
        price: Cl.uint(PRICE),
        window: Cl.uint(WINDOW),
        open: Cl.bool(true),
        received: Cl.uint(0),
        replied: Cl.uint(0),
        earned: Cl.uint(0),
      }),
    );
  });

  it("rejects a zero price", () => {
    expect(openInbox(0).result).toBeErr(Cl.uint(111));
  });

  it("rejects windows outside 60 seconds to 30 days", () => {
    expect(openInbox(PRICE, 59).result).toBeErr(Cl.uint(112));
    expect(openInbox(PRICE, 2_592_001).result).toBeErr(Cl.uint(112));
  });

  it("keeps stats when the owner changes the price", () => {
    openInbox();
    send();
    openInbox(5_000_000);
    const { result } = simnet.callReadOnlyFn("inbox", "get-inbox", [Cl.principal(owner)], owner);
    const inbox = cvToValue(result).value;
    expect(inbox.price.value).toBe("5000000");
    expect(inbox.received.value).toBe("1");
  });
});

describe("send-message", () => {
  it("moves the price into the contract and returns the id", () => {
    openInbox();
    const before = stx(sender);
    const { result, events } = send();
    expect(result).toBeOk(Cl.uint(1));
    expect(stx(sender)).toBe(before - BigInt(PRICE));
    expect(stx(contract)).toBe(BigInt(PRICE));
    expect(events[0].event).toBe("stx_transfer_event");
    expect(message(1).value.status.value).toBe("0");
  });

  it("fails when the inbox does not exist", () => {
    expect(send().result).toBeErr(Cl.uint(100));
  });

  it("fails when the inbox is closed", () => {
    openInbox();
    simnet.callPublicFn("inbox", "close-inbox", [], owner);
    expect(send().result).toBeErr(Cl.uint(101));
  });

  it("fails when messaging yourself", () => {
    openInbox();
    expect(send("hi", PRICE, owner, owner).result).toBeErr(Cl.uint(102));
  });

  it("fails when the price changed", () => {
    openInbox();
    expect(send("hi", PRICE - 1).result).toBeErr(Cl.uint(103));
  });

  it("fails on an empty message", () => {
    openInbox();
    expect(send("").result).toBeErr(Cl.uint(104));
  });

  it("accepts emoji and non Latin text", () => {
    openInbox();
    const body = "Bawo ni 👋 你好";
    expect(send(body).result).toBeOk(Cl.uint(1));
    expect(message(1).value.body.value).toBe(body);
  });
});

describe("reply", () => {
  it("pays the owner and stores the reply", () => {
    openInbox();
    send();
    const before = stx(owner);
    const { result } = simnet.callPublicFn(
      "inbox",
      "reply",
      [Cl.uint(1), Cl.stringUtf8("Sure, send the link.")],
      owner,
    );
    expect(result).toBeOk(Cl.bool(true));
    expect(stx(owner)).toBe(before + BigInt(PRICE));
    expect(stx(contract)).toBe(0n);
    const msg = message(1).value;
    expect(msg.status.value).toBe("1");
    expect((msg.reply.value as { value: string }).value).toBe("Sure, send the link.");

    const { result: inbox } = simnet.callReadOnlyFn("inbox", "get-inbox", [Cl.principal(owner)], owner);
    const stats = cvToValue(inbox).value;
    expect(stats.replied.value).toBe("1");
    expect(stats.earned.value).toBe(String(PRICE));
  });

  it("only the recipient can reply", () => {
    openInbox();
    send();
    const { result } = simnet.callPublicFn("inbox", "reply", [Cl.uint(1), Cl.stringUtf8("x")], outsider);
    expect(result).toBeErr(Cl.uint(106));
  });

  it("cannot reply twice", () => {
    openInbox();
    send();
    simnet.callPublicFn("inbox", "reply", [Cl.uint(1), Cl.stringUtf8("one")], owner);
    const { result } = simnet.callPublicFn("inbox", "reply", [Cl.uint(1), Cl.stringUtf8("two")], owner);
    expect(result).toBeErr(Cl.uint(108));
  });

  it("cannot reply after the window", () => {
    openInbox();
    send();
    passWindow();
    const { result } = simnet.callPublicFn("inbox", "reply", [Cl.uint(1), Cl.stringUtf8("late")], owner);
    expect(result).toBeErr(Cl.uint(109));
  });

  it("cannot send an empty reply", () => {
    openInbox();
    send();
    const { result } = simnet.callPublicFn("inbox", "reply", [Cl.uint(1), Cl.stringUtf8("")], owner);
    expect(result).toBeErr(Cl.uint(104));
  });

  it("fails for a message that does not exist", () => {
    const { result } = simnet.callPublicFn("inbox", "reply", [Cl.uint(9), Cl.stringUtf8("x")], owner);
    expect(result).toBeErr(Cl.uint(105));
  });
});

describe("decline", () => {
  it("refunds the sender in full", () => {
    openInbox();
    const start = stx(sender);
    send();
    const { result } = simnet.callPublicFn("inbox", "decline", [Cl.uint(1)], owner);
    expect(result).toBeOk(Cl.bool(true));
    expect(stx(sender)).toBe(start);
    expect(stx(contract)).toBe(0n);
    expect(message(1).value.status.value).toBe("2");
  });

  it("only the recipient can decline", () => {
    openInbox();
    send();
    expect(simnet.callPublicFn("inbox", "decline", [Cl.uint(1)], sender).result).toBeErr(Cl.uint(106));
  });
});

describe("reclaim", () => {
  it("fails before the window has passed", () => {
    openInbox();
    send();
    expect(simnet.callPublicFn("inbox", "reclaim", [Cl.uint(1)], sender).result).toBeErr(Cl.uint(110));
  });

  it("refunds the sender after the window", () => {
    openInbox();
    const start = stx(sender);
    send();
    passWindow();
    const { result } = simnet.callPublicFn("inbox", "reclaim", [Cl.uint(1)], sender);
    expect(result).toBeOk(Cl.bool(true));
    expect(stx(sender)).toBe(start);
    expect(message(1).value.status.value).toBe("3");
  });

  it("only the sender can reclaim", () => {
    openInbox();
    send();
    passWindow();
    expect(simnet.callPublicFn("inbox", "reclaim", [Cl.uint(1)], owner).result).toBeErr(Cl.uint(107));
  });

  it("cannot reclaim a message that was answered", () => {
    openInbox();
    send();
    simnet.callPublicFn("inbox", "reply", [Cl.uint(1), Cl.stringUtf8("done")], owner);
    passWindow();
    expect(simnet.callPublicFn("inbox", "reclaim", [Cl.uint(1)], sender).result).toBeErr(Cl.uint(108));
  });

  it("uses the window from when the message was sent", () => {
    openInbox();
    send();
    openInbox(PRICE, 2_592_000);
    passWindow();
    expect(simnet.callPublicFn("inbox", "reclaim", [Cl.uint(1)], sender).result).toBeOk(Cl.bool(true));
  });
});

describe("get-page", () => {
  it("pages through an inbox 10 at a time", () => {
    openInbox();
    for (let i = 0; i < 12; i++) send(`message ${i}`);

    const first = simnet.callReadOnlyFn(
      "inbox",
      "get-page",
      [Cl.principal(owner), Cl.uint(0), Cl.uint(0)],
      owner,
    ).result;
    expect(first.type).toBe(ClarityType.Tuple);
    const page1 = cvToValue(first);
    expect(page1.total.value).toBe("12");
    expect(page1.messages.value).toHaveLength(10);
    expect(page1.messages.value[0].value.id.value).toBe("1");

    const page2 = cvToValue(
      simnet.callReadOnlyFn("inbox", "get-page", [Cl.principal(owner), Cl.uint(0), Cl.uint(10)], owner)
        .result,
    );
    expect(page2.messages.value.map((m: { value: { id: { value: string } } }) => m.value.id.value)).toEqual([
      "11",
      "12",
    ]);
  });

  it("keeps sent messages in the sender's box", () => {
    openInbox();
    openInbox(PRICE, WINDOW, outsider);
    send("to owner");
    send("to outsider", PRICE, sender, outsider);
    const sent = cvToValue(
      simnet.callReadOnlyFn("inbox", "get-page", [Cl.principal(sender), Cl.uint(1), Cl.uint(0)], sender)
        .result,
    );
    expect(sent.total.value).toBe("2");
    const inbox = cvToValue(
      simnet.callReadOnlyFn("inbox", "get-page", [Cl.principal(owner), Cl.uint(0), Cl.uint(0)], owner).result,
    );
    expect(inbox.total.value).toBe("1");
  });

  it("returns an empty page for someone with no messages", () => {
    const empty = cvToValue(
      simnet.callReadOnlyFn("inbox", "get-page", [Cl.principal(outsider), Cl.uint(0), Cl.uint(0)], outsider)
        .result,
    );
    expect(empty.total.value).toBe("0");
    expect(empty.messages.value).toHaveLength(0);
  });
});
