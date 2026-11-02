import { required, useTranslate } from "ra-core";
import { useWatch } from "react-hook-form";
import { AutocompleteArrayInput } from "@/components/admin/autocomplete-array-input";
import { ReferenceArrayInput } from "@/components/admin/reference-array-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { TextInput } from "@/components/admin/text-input";
import { NumberInput } from "@/components/admin/number-input";
import { DateInput } from "@/components/admin/date-input";
import { SelectInput } from "@/components/admin/select-input";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";

import { useConfigurationContext } from "../root/ConfigurationContext";
import { AutocompleteCompanyInput } from "../companies/AutocompleteCompanyInput.tsx";
import { AutocompleteContactInput } from "../contacts/AutocompleteContactInput.tsx";
import { serviceSpaceChoices } from "./serviceSpaceTypes";

export const DealInputs = () => {
  const isMobile = useIsMobile();
  return (
    <div className="flex flex-col gap-10 p-1">
      <DealInfoInputs />

      <ServiceInputs />

      <div className={`flex gap-6 ${isMobile ? "flex-col" : "flex-row"}`}>
        <DealLinkedToInputs />
        <Separator orientation={isMobile ? "horizontal" : "vertical"} />
        <DealMiscInputs />
      </div>
    </div>
  );
};

const DealInfoInputs = () => {
  return (
    <div className="flex flex-col gap-4 flex-1">
      <TextInput source="name" validate={required()} helperText={false} />
      <TextInput source="description" multiline rows={3} helperText={false} />
    </div>
  );
};

const DealLinkedToInputs = () => {
  const translate = useTranslate();
  const stage = useWatch({ name: "stage" });
  const contacts = useWatch({ name: "contact_ids" });
  return (
    <div className="flex flex-col gap-4 flex-1">
      <h6 className="text-lg font-semibold">
        {translate("resources.deals.inputs.linked_to")}
      </h6>
      <ReferenceInput source="company_id" reference="companies">
        <AutocompleteCompanyInput
          label="resources.deals.fields.company_id"
          modal
        />
      </ReferenceInput>

      <ReferenceArrayInput source="contact_ids" reference="contacts_summary">
        <AutocompleteContactInput
          label="resources.deals.fields.contact_ids"
          validate={(value, values) =>
            values.stage === "won" &&
            (!Array.isArray(value) || value.length === 0)
              ? "resources.deals.followup_contact_required"
              : undefined
          }
        />
      </ReferenceArrayInput>
      {stage === "won" && (
        <p className="text-sm text-muted-foreground" role="status">
          {!contacts?.length
            ? translate("resources.deals.followup_contact_required")
            : translate("resources.deals.followup_hint")}
        </p>
      )}
    </div>
  );
};

const ServiceInputs = () => {
  const translate = useTranslate();
  return (
    <section className="flex flex-col gap-4">
      <h6 className="text-lg font-semibold">
        {translate("resources.deals.field_categories.service")}
      </h6>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SelectInput
          source="service_space_type"
          choices={serviceSpaceChoices}
          parse={(value) => value || null}
          helperText={false}
        />
        <TextInput source="service_address" helperText={false} />
        <TextInput source="service_space_size" helperText={false} />
        <DateInput source="service_visit_date" helperText={false} />
        <TextInput
          source="service_visit_time"
          type="time"
          format={(value) =>
            typeof value === "string" ? value.slice(0, 5) : ""
          }
          parse={(value) => value || null}
          helperText={false}
        />
      </div>
    </section>
  );
};

const DealMiscInputs = () => {
  const { dealStages, dealCategories } = useConfigurationContext();
  const translate = useTranslate();
  return (
    <div className="flex flex-col gap-4 flex-1">
      <h6 className="text-lg font-semibold">
        {translate("resources.deals.field_categories.misc")}
      </h6>

      <AutocompleteArrayInput
        source="categories"
        choices={dealCategories}
        optionText="label"
        optionValue="value"
        helperText={false}
      />
      <NumberInput
        source="amount"
        defaultValue={0}
        step={1}
        helperText={translate("resources.deals.amount_integer_hint")}
        validate={required()}
      />
      <DateInput
        validate={required()}
        source="expected_closing_date"
        helperText={false}
        defaultValue={new Date().toISOString().split("T")[0]}
      />
      <SelectInput
        source="stage"
        choices={dealStages}
        optionText="label"
        optionValue="value"
        defaultValue="opportunity"
        helperText={false}
        validate={required()}
      />
    </div>
  );
};
