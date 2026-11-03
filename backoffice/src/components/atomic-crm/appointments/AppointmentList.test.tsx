import type { ReactNode } from "react";
import { CoreAdminContext, ResourceContextProvider, type DataProvider } from "ra-core";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { AppointmentList, type Appointment } from "./AppointmentList";

const rows: Appointment[] = [
  {
    id: 1,
    deal_id: 11,
    deal_name: "Nueva consulta",
    contact_id: 21,
    first_name: "Carlos",
    last_name: "Pérez",
    technician_id: 1,
    technician_name: "Técnico de ejemplo",
    start_at: "2030-06-04T15:00:00Z",
    end_at: "2030-06-04T16:00:00Z",
    status: "confirmed",
    hold_expires_at: null,
    address: "123 Main St, Orlando",
    is_test: false,
  },
  {
    id: 2,
    deal_id: 12,
    deal_name: "Servicio de prueba",
    contact_id: 22,
    first_name: "Prueba",
    last_name: "Sebas",
    technician_id: 1,
    technician_name: "Técnico de ejemplo",
    start_at: "2030-06-05T15:00:00Z",
    end_at: "2030-06-05T16:00:00Z",
    status: "hold",
    hold_expires_at: "2030-06-05T14:15:00Z",
    address: null,
    is_test: true,
  },
];

const i18n = {
  translate: (key: string, options?: { _?: string }) => options?._ ?? key,
  changeLocale: () => Promise.resolve(),
  getLocale: () => "es",
};

const Wrapper = ({ children, dataProvider }: { children: ReactNode; dataProvider: DataProvider }) => (
  <CoreAdminContext dataProvider={dataProvider} i18nProvider={i18n}>
    <ResourceContextProvider value="appointments">{children}</ResourceContextProvider>
  </CoreAdminContext>
);

const provider = (data: Appointment[]): DataProvider =>
  ({
    getList: async () => ({ data, total: data.length }),
    getMany: async () => ({ data: [] }),
    getManyReference: async () => ({ data: [], total: 0 }),
  }) as unknown as DataProvider;

describe("AppointmentList", () => {
  it("shows each appointment with its customer, opportunity, technician and address", async () => {
    const screen = await render(
      <Wrapper dataProvider={provider(rows)}>
        <AppointmentList />
      </Wrapper>,
    );

    await expect.element(screen.getByText("Carlos Pérez")).toBeVisible();
    await expect.element(screen.getByText("Nueva consulta")).toBeVisible();
    await expect.element(screen.getByText("123 Main St, Orlando")).toBeVisible();
    await expect.element(screen.getByText("Prueba Sebas")).toBeVisible();
  });

  it("marks what is held and what is a test, so nobody mistakes them for confirmed services", async () => {
    const screen = await render(
      <Wrapper dataProvider={provider(rows)}>
        <AppointmentList />
      </Wrapper>,
    );

    // The test translator answers with the fallback text, which is the status itself.
    await expect.element(screen.getByText("confirmed", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("hold", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Test", { exact: true })).toBeVisible();
  });

  it("links to the customer and to the opportunity", async () => {
    const screen = await render(
      <Wrapper dataProvider={provider(rows)}>
        <AppointmentList />
      </Wrapper>,
    );
    await expect.element(screen.getByRole("link", { name: "Carlos Pérez" })).toHaveAttribute("href", expect.stringContaining("/contacts/21/show"));
    await expect.element(screen.getByRole("link", { name: "Nueva consulta" })).toHaveAttribute("href", expect.stringContaining("/deals/11/show"));
  });

  it("is read only: no create, edit or delete button", async () => {
    const screen = await render(
      <Wrapper dataProvider={provider(rows)}>
        <AppointmentList />
      </Wrapper>,
    );
    await expect.element(screen.getByText("Carlos Pérez")).toBeVisible();
    for (const name of [/create|crear|new|nueva/i, /edit|editar/i, /delete|eliminar|borrar/i]) {
      expect(screen.getByRole("button", { name }).elements()).toHaveLength(0);
    }
  });

  it("shows nothing broken when there are no appointments", async () => {
    const screen = await render(
      <Wrapper dataProvider={provider([])}>
        <AppointmentList />
      </Wrapper>,
    );
    await expect.element(screen.getByText("Carlos Pérez")).not.toBeInTheDocument();
  });
});
