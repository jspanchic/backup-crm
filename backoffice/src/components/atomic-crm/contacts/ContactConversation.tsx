import { useEffect, useRef } from "react";
import { useGetList, useTranslate } from "ra-core";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { Contact } from "../types";

type Message = {
  id: number;
  direction: "in" | "out";
  sender: "client" | "bot" | "human";
  body: string;
  sent_at: string;
};

// The bot writes {{telefono}} and core-api fills it in only in what it sends, so the stored text keeps it.
const PHONE_PLACEHOLDER = /\{\{\s*telefono\s*\}\}/g;

const phoneOf = (contact: Contact): string =>
  contact.phone_jsonb?.find((phone) => phone.number)?.number ?? "";

const formatSentAt = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** What was said in WhatsApp with this contact, oldest first. Read only: the bot and the team answer from WhatsApp. */
export const ContactConversation = ({ contact }: { contact: Contact }) => {
  const translate = useTranslate();
  const end = useRef<HTMLLIElement>(null);
  const { data, isPending, error } = useGetList<Message>(
    "conversation_messages",
    {
      filter: { contact_id: contact.id },
      sort: { field: "sent_at", order: "ASC" },
      pagination: { page: 1, perPage: 500 },
    },
  );

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [data?.length]);

  if (isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton className="h-10 w-2/3" key={index} />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {translate("crm.conversation.error")}
      </p>
    );
  }
  if (!data?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate("crm.conversation.empty")}
      </p>
    );
  }

  const phone = phoneOf(contact);
  return (
    <ol
      aria-label={translate("crm.conversation.tab")}
      className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1"
    >
      {data.map((message) => {
        const ours = message.direction === "out";
        return (
          <li
            key={message.id}
            className={cn("flex flex-col", ours ? "items-end" : "items-start")}
          >
            <div
              className={cn(
                "max-w-[80%] whitespace-pre-line rounded-lg px-3 py-2 text-sm",
                ours ? "bg-primary/10" : "bg-muted",
              )}
            >
              {message.body.replace(PHONE_PLACEHOLDER, phone)}
            </div>
            <span className="mt-0.5 text-xs text-muted-foreground">
              {translate(`crm.conversation.sender.${message.sender}`)} ·{" "}
              {formatSentAt(message.sent_at)}
            </span>
          </li>
        );
      })}
      <li ref={end} aria-hidden="true" />
    </ol>
  );
};
