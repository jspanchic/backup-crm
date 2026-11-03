import type { ReactNode } from "react";
import { CoreAdminContext, type DataProvider } from "ra-core";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import type { Contact } from "../types";
import { ContactConversation } from "./ContactConversation";

const contact = {
  id: 7,
  first_name: "Carlos",
  last_name: "Pérez",
  phone_jsonb: [{ number: "+13055550123", type: "Other" }],
} as unknown as Contact;

const messages = [
  { id: 1, direction: "in", sender: "client", body: "Hola, quiero una cotización", sent_at: "2030-06-04T15:00:00Z" },
  { id: 2, direction: "out", sender: "bot", body: "Tu celular es {{telefono}}, ¿es correcto?", sent_at: "2030-06-04T15:00:05Z" },
  { id: 3, direction: "out", sender: "human", body: "Te llamo en un momento", sent_at: "2030-06-04T15:05:00Z" },
];

const i18n = {
  translate: (key: string) => key,
  changeLocale: () => Promise.resolve(),
  getLocale: () => "es",
};

const render_ = (getList: DataProvider["getList"], children: ReactNode = <ContactConversation contact={contact} />) =>
  render(
    <CoreAdminContext dataProvider={{ getList } as unknown as DataProvider} i18nProvider={i18n}>
      {children}
    </CoreAdminContext>,
  );

describe("ContactConversation", () => {
  it("asks for the messages of this contact only, oldest first", async () => {
    const asked: unknown[] = [];
    const screen = await render_(async (resource, params) => {
      asked.push({ resource, filter: params.filter, sort: params.sort });
      return { data: messages as never[], total: messages.length };
    });

    await expect.element(screen.getByText("Hola, quiero una cotización")).toBeVisible();
    expect(asked[0]).toEqual({
      resource: "conversation_messages",
      filter: { contact_id: 7 },
      sort: { field: "sent_at", order: "ASC" },
    });
  });

  it("shows who said each message", async () => {
    const screen = await render_(async () => ({ data: messages as never[], total: 3 }));

    await expect.element(screen.getByText(/crm\.conversation\.sender\.client/)).toBeVisible();
    await expect.element(screen.getByText(/crm\.conversation\.sender\.bot/)).toBeVisible();
    await expect.element(screen.getByText(/crm\.conversation\.sender\.human/)).toBeVisible();
  });

  it("fills in the phone the bot left as a placeholder, so nobody reads {{telefono}}", async () => {
    const screen = await render_(async () => ({ data: messages as never[], total: 3 }));

    await expect.element(screen.getByText("Tu celular es +13055550123, ¿es correcto?")).toBeVisible();
    expect(screen.container.textContent).not.toContain("{{telefono}}");
  });

  it("says so when there are no messages yet", async () => {
    const screen = await render_(async () => ({ data: [], total: 0 }));

    await expect.element(screen.getByText("crm.conversation.empty")).toBeVisible();
  });

  it("says so when the conversation cannot be loaded", async () => {
    const screen = await render_(async () => {
      throw new Error("boom");
    });

    await expect.element(screen.getByRole("alert")).toHaveTextContent("crm.conversation.error");
  });
});
