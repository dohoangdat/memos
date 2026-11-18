import { describe, expect, it } from "vitest";
import {
  combineMemoKey,
  decryptMemoContent,
  derivePasskeyMaterial,
  encryptMemoContent,
  isLockedContent,
  lockedTags,
  lockedTitle,
  memoTags,
  newPasskeySalt,
} from "@/lib/memo-crypto";

const share = btoa("s".repeat(32));
const keyFor = async (passkey: string, salt = newPasskeySalt(), withShare = share) =>
  combineMemoKey((await derivePasskeyMaterial(passkey, salt)).wrap, withShare);

describe("memo passkey encryption", () => {
  it("derives a stable proof for the server and keeps the other half local", async () => {
    const salt = newPasskeySalt();
    const first = await derivePasskeyMaterial("123456", salt);
    const again = await derivePasskeyMaterial("123456", salt);
    const other = await derivePasskeyMaterial("654321", salt);
    expect(first.proof).toBe(again.proof);
    expect(first.proof).not.toBe(other.proof);
    expect(atob(first.proof)).toHaveLength(32);
    expect(first.wrap).toHaveLength(32);
    // The proof the server sees is not the half that makes the key.
    expect(btoa(String.fromCharCode(...first.wrap))).not.toBe(first.proof);
    await expect(derivePasskeyMaterial("12345", salt)).rejects.toThrow();
  }, 30_000);

  it("keeps the title and tags readable and round-trips the content", async () => {
    const salt = newPasskeySalt();
    const key = await keyFor("246810", salt);
    const content = "# Bank #ca-nhan\n\nTK 0123 4567 #ca-nhan/tai-chinh #ngan-hang\n\n```\n#not-a-tag\n```\n\n- [ ] gia hạn thẻ `#nope`";
    const locked = await encryptMemoContent(content, key);

    expect(isLockedContent(locked)).toBe(true);
    expect(lockedTitle(locked)).toBe("# Bank #ca-nhan");
    expect(lockedTags(locked)).toEqual(["ca-nhan/tai-chinh", "ngan-hang"]);
    expect(locked).not.toContain("0123");
    expect(locked).not.toContain("not-a-tag");
    expect(await decryptMemoContent(locked, key)).toBe(content);
    // A fresh IV each time: the same text never encrypts the same way twice.
    expect(await encryptMemoContent(content, key)).not.toBe(locked);

    // Both halves are needed: the same passkey with another share, or another salt, does not open it.
    await expect(decryptMemoContent(locked, await keyFor("246810", salt, btoa("x".repeat(32))))).rejects.toThrow();
    await expect(decryptMemoContent(locked, await keyFor("246810"))).rejects.toThrow();
    expect(await decryptMemoContent(locked, await keyFor("246810", salt))).toBe(content);
  }, 60_000);

  it("finds tags the way a memo writes them", () => {
    expect(memoTags("#a text #b/c, #b and #Tài-chính\n# Heading\nmail@x.com #d#e")).toEqual(["a", "b/c", "Tài-chính", "d"]);
  });

  it("handles a large memo", async () => {
    const key = await keyFor("135790");
    const content = `# Big\n\n${"Nội dung dài. ".repeat(200_000)}`;
    expect(await decryptMemoContent(await encryptMemoContent(content, key), key)).toBe(content);
  }, 60_000);

  it("locks a memo without a title or tags too", async () => {
    const key = await keyFor("000000");
    const locked = await encryptMemoContent("just text", key);
    expect(lockedTitle(locked)).toBe("");
    expect(lockedTags(locked)).toEqual([]);
    expect(await decryptMemoContent(locked, key)).toBe("just text");
    expect(isLockedContent("plain memo")).toBe(false);
  }, 30_000);
});
