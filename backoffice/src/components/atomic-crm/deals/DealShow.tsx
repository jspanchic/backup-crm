import { useMutation } from "@tanstack/react-query";
import { isValid } from "date-fns";
import { Archive, ArchiveRestore } from "lucide-react";
import {
  InfiniteListBase,
  ShowBase,
  useDataProvider,
  useNotify,
  useLocaleState,
  useRecordContext,
  useRedirect,
  useRefresh,
  useTranslate,
  useUpdate,
} from "ra-core";
import { DeleteButton } from "@/components/admin/delete-button";
import { EditButton } from "@/components/admin/edit-button";
import { ReferenceArrayField } from "@/components/admin/reference-array-field";
import { ReferenceField } from "@/components/admin/reference-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

import { CompanyAvatar } from "../companies/CompanyAvatar";
import { NoteCreate } from "../notes/NoteCreate";
import { NotesIterator } from "../notes/NotesIterator";
import { isCoreApiProvider } from "../providers/core-api";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";
import { ContactList } from "./ContactList";
import { formatUsd } from "../presentation/money";
import { isPresentationMode } from "../presentation/presentationMode";
import { DealDocuments } from "./DealDocuments";
import { DealStageSelect } from "./DealStageSelect";
import {
  findDealLabel,
  formatDealCategories,
  formatISODateString,
} from "./dealUtils";

export const DealShow = ({ open, id }: { open: boolean; id?: string }) => {
  const redirect = useRedirect();
  const handleClose = () => {
    redirect("list", "deals");
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="lg:max-w-4xl p-4 overflow-y-auto max-h-9/10 top-1/20 translate-y-0">
        {id ? (
          <ShowBase id={id}>
            <DealShowContent />
          </ShowBase>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

const DealShowContent = () => {
  const translate = useTranslate();
  const [locale] = useLocaleState();
  const { dealStages, dealCategories, currency } = useConfigurationContext();
  const record = useRecordContext<Deal>();
  if (!record) return null;

  return (
    <>
      <div className="space-y-2">
        {record.archived_at ? <ArchivedTitle /> : null}
        <div className="flex-1">
          <div className="flex justify-between items-start mb-8">
            <div className="flex items-center gap-4">
              <ReferenceField
                source="company_id"
                reference="companies"
                link="show"
              >
                <CompanyAvatar />
              </ReferenceField>
              <h2 className="text-xl font-semibold">{record.name}</h2>
            </div>
            <div className={`flex gap-2 ${record.archived_at ? "" : "pr-12"}`}>
              {record.archived_at ? (
                <>
                  <UnarchiveButton record={record} />
                  <DeleteButton />
                </>
              ) : (
                <>
                  <ArchiveButton record={record} />
                  <EditButton />
                </>
              )}
            </div>
          </div>

          <div className="flex gap-8 m-4">
            <div className="flex flex-col mr-10">
              <span className="text-xs text-muted-foreground tracking-wide">
                {translate("resources.deals.fields.expected_closing_date")}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm">
                  {/* Deals that come from the bot have no expected closing date. */}
                  {!record.expected_closing_date
                    ? "—"
                    : isValid(new Date(record.expected_closing_date))
                      ? formatISODateString(record.expected_closing_date)
                      : translate("resources.deals.invalid_date")}
                </span>
                {record.expected_closing_date &&
                new Date(record.expected_closing_date) < new Date() ? (
                  <Badge variant="destructive">
                    {translate("crm.common.past")}
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col mr-10">
              <span className="text-xs text-muted-foreground tracking-wide">
                {translate("resources.deals.fields.amount")}
              </span>
              <span className="text-sm">
                {/* A deal that was not quoted yet has no amount. */}
                {isPresentationMode()
                  ? formatUsd(record.amount)
                  : (record.amount ?? 0).toLocaleString("en-US", {
                      notation: "compact",
                      style: "currency",
                      currency,
                      currencyDisplay: "narrowSymbol",
                      minimumSignificantDigits: 3,
                    })}
              </span>
            </div>

            {!!record.categories?.length && (
              <div className="flex flex-col mr-10">
                <span className="text-xs text-muted-foreground tracking-wide">
                  {translate("resources.deals.fields.categories")}
                </span>
                <span className="text-sm">
                  {formatDealCategories(dealCategories, record.categories)}
                </span>
              </div>
            )}

            <div className="flex flex-col mr-10">
              <span className="text-xs text-muted-foreground tracking-wide">
                {translate("resources.deals.fields.stage")}
              </span>
              {record.archived_at ? (
                <span className="text-sm">
                  {findDealLabel(dealStages, record.stage)}
                </span>
              ) : (
                <DealStageSelect deal={record} />
              )}
            </div>
          </div>

          {!!record.contact_ids?.length && (
            <div className="m-4">
              <div className="flex flex-col min-h-12 mr-10">
                <span className="text-xs text-muted-foreground tracking-wide">
                  {translate("resources.deals.fields.contact_ids")}
                </span>
                <ReferenceArrayField
                  source="contact_ids"
                  reference="contacts_summary"
                >
                  <ContactList />
                </ReferenceArrayField>
              </div>
            </div>
          )}

          {record.stage === "won" && !record.contact_ids?.length && (
            <p
              className="m-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
              role="status"
            >
              {translate("resources.deals.followup_contact_required")}
            </p>
          )}

          {record.description && (
            <div className="m-4 whitespace-pre-line">
              <span className="text-xs text-muted-foreground tracking-wide">
                {translate("resources.deals.fields.description")}
              </span>
              <p className="text-sm leading-6">{record.description}</p>
            </div>
          )}

          {(record.service_space_type ||
            record.service_address ||
            record.service_space_size ||
            record.service_visit_date ||
            record.service_visit_time) && (
            <section className="m-4">
              <Separator className="mb-4" />
              <h3 className="mb-3 font-semibold">
                {translate("resources.deals.field_categories.service")}
              </h3>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  {
                    key: "service_space_type",
                    value: record.service_space_type
                      ? translate(
                          `resources.deals.service_space_types.${record.service_space_type}`,
                          { _: record.service_space_type },
                        )
                      : null,
                  },
                  { key: "service_address", value: record.service_address },
                  {
                    key: "service_space_size",
                    value: record.service_space_size,
                  },
                  {
                    key: "service_visit_date",
                    value: record.service_visit_date
                      ? new Intl.DateTimeFormat(locale || "es").format(
                          new Date(`${record.service_visit_date}T00:00:00`),
                        )
                      : null,
                  },
                  {
                    key: "service_visit_time",
                    value: record.service_visit_time?.slice(0, 5),
                  },
                ]
                  .filter(({ value }) => value)
                  .map(({ key, value }) => (
                    <div key={key} className="min-w-0">
                      <dt className="text-xs text-muted-foreground">
                        {translate(`resources.deals.fields.${key}`)}
                      </dt>
                      <dd className="whitespace-pre-line break-words text-sm">
                        {value}
                      </dd>
                    </div>
                  ))}
              </dl>
            </section>
          )}

          {isCoreApiProvider() ? <DealDocuments dealId={Number(record.id)} /> : null}

          <div className="m-4">
            <Separator className="mb-4" />
            <InfiniteListBase
              resource="deal_notes"
              filter={{ deal_id: record.id }}
              sort={{ field: "date", order: "DESC" }}
              perPage={25}
              disableSyncWithLocation
              storeKey={false}
              empty={<NoteCreate reference={"deals"} />}
            >
              <NotesIterator reference="deals" />
            </InfiniteListBase>
          </div>
        </div>
      </div>
    </>
  );
};

const ArchivedTitle = () => {
  const translate = useTranslate();
  return (
    <div className="bg-orange-500 px-6 py-4">
      <h3 className="text-lg font-bold text-white">
        {translate("resources.deals.archived.title")}
      </h3>
    </div>
  );
};

const ArchiveButton = ({ record }: { record: Deal }) => {
  const translate = useTranslate();
  const [update] = useUpdate();
  const redirect = useRedirect();
  const notify = useNotify();
  const refresh = useRefresh();
  const handleClick = () => {
    update(
      "deals",
      {
        id: record.id,
        data: { archived_at: new Date().toISOString() },
        previousData: record,
      },
      {
        onSuccess: () => {
          redirect("list", "deals");
          notify("resources.deals.archived.success", {
            type: "info",
            undoable: false,
          });
          refresh();
        },
        onError: () => {
          notify("resources.deals.archived.error", {
            type: "error",
          });
        },
      },
    );
  };

  return (
    <Button
      onClick={handleClick}
      size="sm"
      variant="outline"
      className="flex items-center gap-2 h-9"
    >
      <Archive className="w-4 h-4" />
      {translate("resources.deals.archived.action")}
    </Button>
  );
};

const UnarchiveButton = ({ record }: { record: Deal }) => {
  const translate = useTranslate();
  const dataProvider = useDataProvider();
  const redirect = useRedirect();
  const notify = useNotify();
  const refresh = useRefresh();

  const { mutate } = useMutation({
    mutationFn: () => dataProvider.unarchiveDeal(record),
    onSuccess: () => {
      redirect("list", "deals");
      notify("resources.deals.unarchived.success", {
        type: "info",
        undoable: false,
      });
      refresh();
    },
    onError: () => {
      notify("resources.deals.unarchived.error", {
        type: "error",
      });
    },
  });

  const handleClick = () => {
    mutate();
  };

  return (
    <Button
      onClick={handleClick}
      size="sm"
      variant="outline"
      className="flex items-center gap-2 h-9"
    >
      <ArchiveRestore className="w-4 h-4" />
      {translate("resources.deals.unarchived.action")}
    </Button>
  );
};
