import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Contact, EmailAndType } from "../../types";
import { getContactAvatar, hash } from "./getContactAvatar";

describe("getContactAvatar", () => {
  let faviconAvailable = false;
  beforeEach(async () => {
    faviconAvailable = false;
    const existingAvatarHash = await hash("anthony@marmelab.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok:
          url === `https://www.gravatar.com/avatar/${existingAvatarHash}?d=404` ||
          (url.endsWith("/favicon.ico") && faviconAvailable),
      })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("should return gravatar URL for anthony@marmelab.com", async () => {
    const email: EmailAndType[] = [
      { email: "anthony@marmelab.com", type: "Work" },
    ];
    const record: Partial<Contact> = { email_jsonb: email };

    const avatarUrl = await getContactAvatar(record);
    const hashedEmail = await hash(email[0].email);
    expect(avatarUrl).toBe(
      `https://www.gravatar.com/avatar/${hashedEmail}?d=404`,
    );
  });

  it("should return favicon URL if gravatar does not exist", async () => {
    faviconAvailable = true;
    const email: EmailAndType[] = [
      { email: "no-gravatar@gravatar.com", type: "Work" },
    ];
    const record: Partial<Contact> = { email_jsonb: email };

    const avatarUrl = await getContactAvatar(record);
    expect(avatarUrl).toBe("https://gravatar.com/favicon.ico");
  });

  it("should not return favicon URL if not domain not allowed", async () => {
    const email: EmailAndType[] = [
      { email: "no-gravatar@gmail.com", type: "Work" },
    ];
    const record: Partial<Contact> = { email_jsonb: email };

    const avatarUrl = await getContactAvatar(record);
    expect(avatarUrl).toBeNull();
  });

  it("should return null if no email is provided", async () => {
    const record: Partial<Contact> = {};

    const avatarUrl = await getContactAvatar(record);
    expect(avatarUrl).toBeNull();
  });

  it("should return null if an empty array is provided", async () => {
    const email: EmailAndType[] = [];
    const record: Partial<Contact> = { email_jsonb: email };

    const avatarUrl = await getContactAvatar(record);
    expect(avatarUrl).toBeNull();
  });

  it("should return null if email has no gravatar or validate domain", async () => {
    faviconAvailable = false;
    const email: EmailAndType[] = [
      { email: "anthony@fake-domain-marmelab.com", type: "Work" },
    ];
    const record: Partial<Contact> = { email_jsonb: email };

    const avatarUrl = await getContactAvatar(record);
    expect(avatarUrl).toBeNull();
  });

  it("should return gravatar URL for 2nd email if 1st email has no gravatar nor valid domain", async () => {
    const email: EmailAndType[] = [
      { email: "anthony@fake-domain-marmelab.com", type: "Work" },
      { email: "anthony@marmelab.com", type: "Work" },
    ];
    const record: Partial<Contact> = { email_jsonb: email };

    const avatarUrl = await getContactAvatar(record);
    const hashedEmail = await hash(email[1].email);
    expect(avatarUrl).toBe(
      `https://www.gravatar.com/avatar/${hashedEmail}?d=404`,
    );
  });
});
