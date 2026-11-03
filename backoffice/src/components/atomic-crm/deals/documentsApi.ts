import { HttpError } from "ra-core";

import { getCoreApiUrl, httpClient } from "../providers/core-api/httpClient";

// The documents of a deal (quote, purchase order, work order) are numbered, rendered and sent by core-api
// (/admin/documents): the rules, including the lock on real customers, are there, and a refusal comes back
// as { error, reason }.

export type DocumentType = "quote" | "purchase_order" | "work_order";

export type DealDocument = {
  id: number;
  display_number: string;
  document_type: DocumentType;
  is_test: boolean;
  status: string;
  issued_at: string;
  appointment_id: number | null;
  file: { id: number; size_bytes: number } | null;
  sent_at: string | null;
  send_status: "pending" | "sending" | "sent" | "failed" | null;
};

export type DealDocuments = {
  documents: DealDocument[];
  can_issue: Record<DocumentType, boolean>;
  /** False while the legal texts are not confirmed: documents of real customers cannot be sent. */
  legal_confirmed: boolean;
};

const base = () => `${getCoreApiUrl()}/admin/documents`;

export const getDealDocuments = async (
  dealId: number,
): Promise<DealDocuments> => {
  const { json } = await httpClient(`${base()}?deal_id=${dealId}`);
  return json as DealDocuments;
};

export const issueDocument = async (dealId: number, type: DocumentType) => {
  const { json } = await httpClient(base(), {
    method: "POST",
    headers: new Headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ deal_id: dealId, document_type: type }),
  });
  return json as { id: number; display_number: string };
};

export const sendDocument = async (id: number) => {
  const { json } = await httpClient(`${base()}/${id}/send`, { method: "POST" });
  return json as { outbox_id: number };
};

/** The PDF comes with the session cookie, so it is fetched and saved from here instead of linked. */
export const downloadDocument = async (
  id: number,
  displayNumber: string,
): Promise<void> => {
  const response = await fetch(`${base()}/${id}/pdf`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new HttpError(
      response.statusText,
      response.status,
      await response.json().catch(() => undefined),
    );
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `${displayNumber}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
