import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Lock, Send } from "lucide-react";
import { useLocaleState, useNotify, useTranslate } from "ra-core";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { errorKey } from "../appointments/calendarApi";
import {
  downloadDocument,
  getDealDocuments,
  issueDocument,
  sendDocument,
  type DealDocument,
  type DocumentType,
} from "./documentsApi";

const TYPES: DocumentType[] = ["quote", "purchase_order", "work_order"];

/**
 * The "Documents" section of a deal: what was issued, and the buttons to generate, download and send.
 * Everything is core-api's to allow or refuse; the lock on real customers shows here as a disabled Send.
 */
export const DealDocuments = ({ dealId }: { dealId: number }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const [locale] = useLocaleState();
  const queryClient = useQueryClient();
  const queryKey = ["deal-documents", dealId];

  const { data } = useQuery({
    queryKey,
    queryFn: () => getDealDocuments(dealId),
  });

  const fail = (error: unknown) =>
    notify(`resources.deals.documents.errors.${errorKey(error)}`, {
      type: "error",
      messageArgs: { _: translate("resources.deals.documents.errors.unknown") },
    });
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const generate = useMutation({
    mutationFn: (type: DocumentType) => issueDocument(dealId, type),
    onSuccess: (document) => {
      notify("resources.deals.documents.generated", {
        type: "info",
        messageArgs: { number: document.display_number },
      });
      return refresh();
    },
    onError: fail,
  });
  const send = useMutation({
    mutationFn: (document: DealDocument) =>
      sendDocument(document.id).then(() => document),
    onSuccess: (document) => {
      notify("resources.deals.documents.queued_notice", {
        type: "info",
        messageArgs: { number: document.display_number },
      });
      return refresh();
    },
    onError: fail,
  });
  const download = useMutation({
    mutationFn: (document: DealDocument) =>
      downloadDocument(document.id, document.display_number),
    onError: fail,
  });

  if (!data) return null;
  const dateFormat = new Intl.DateTimeFormat(locale || "es", {
    dateStyle: "medium",
  });
  const lockedFor = (document: DealDocument) =>
    !document.is_test && !data.legal_confirmed;

  const sendState = (document: DealDocument) => {
    if (document.document_type === "work_order") return null;
    if (document.sent_at)
      return `${translate("resources.deals.documents.sent")} ${dateFormat.format(new Date(document.sent_at))}`;
    if (document.send_status === "failed")
      return translate("resources.deals.documents.send_failed");
    if (document.send_status)
      return translate("resources.deals.documents.queued");
    return translate("resources.deals.documents.not_sent");
  };

  return (
    <section className="m-4" aria-labelledby="deal-documents-title">
      <Separator className="mb-4" />
      <h3 id="deal-documents-title" className="mb-3 font-semibold">
        {translate("resources.deals.documents.title")}
      </h3>

      {data.documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("resources.deals.documents.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {data.documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
            >
              <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="font-medium">{document.display_number}</span>
              <span className="text-muted-foreground">
                {translate(
                  `resources.deals.documents.types.${document.document_type}`,
                )}{" "}
                · {dateFormat.format(new Date(document.issued_at))}
              </span>
              {document.is_test ? (
                <Badge variant="outline">
                  {translate("resources.deals.documents.test")}
                </Badge>
              ) : null}
              {document.file ? (
                <span className="text-muted-foreground">
                  {sendState(document)}
                </span>
              ) : (
                <Badge variant="destructive">
                  {translate("resources.deals.documents.no_file")}
                </Badge>
              )}
              {document.document_type === "work_order" ? (
                <span className="text-xs text-muted-foreground">
                  {translate("resources.deals.documents.for_technician")}
                </span>
              ) : null}

              <span className="ml-auto flex gap-2">
                {document.file ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={download.isPending}
                    onClick={() => download.mutate(document)}
                  >
                    <Download className="h-4 w-4" aria-hidden />
                    {translate("resources.deals.documents.download")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={generate.isPending}
                    onClick={() => generate.mutate(document.document_type)}
                  >
                    {translate("resources.deals.documents.generate_pdf")}
                  </Button>
                )}
                {document.file && document.document_type !== "work_order" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={send.isPending || lockedFor(document)}
                    title={
                      lockedFor(document)
                        ? translate("resources.deals.documents.locked_hint")
                        : undefined
                    }
                    onClick={() => send.mutate(document)}
                  >
                    {lockedFor(document) ? (
                      <Lock className="h-4 w-4" aria-hidden />
                    ) : (
                      <Send className="h-4 w-4" aria-hidden />
                    )}
                    {document.sent_at || document.send_status
                      ? translate("resources.deals.documents.send_again")
                      : translate("resources.deals.documents.send")}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {TYPES.filter((type) => data.can_issue[type]).map((type) => (
          <Button
            key={type}
            type="button"
            size="sm"
            variant="outline"
            disabled={generate.isPending}
            onClick={() => generate.mutate(type)}
          >
            {translate("resources.deals.documents.generate", {
              type: translate(`resources.deals.documents.types.${type}`),
            })}
          </Button>
        ))}
      </div>

      {!data.legal_confirmed ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden />
          {translate("resources.deals.documents.locked")}
        </p>
      ) : null}
    </section>
  );
};
