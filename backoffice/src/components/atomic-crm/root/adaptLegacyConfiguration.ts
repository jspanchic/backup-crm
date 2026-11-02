import type { ConfigurationContextValue } from "./ConfigurationContext";
import { defaultConfiguration } from "./defaultConfiguration";

// Upgrade untouched Atomic CRM defaults held in an existing browser cache.
// Custom configurations are deliberately left intact.
const previousStages = [
  ["opportunity", "Opportunity"],
  ["proposal-sent", "Proposal Sent"],
  ["in-negociation", "In Negotiation"],
  ["won", "Won"],
  ["lost", "Lost"],
  ["delayed", "Delayed"],
];
const previousCategories = [
  ["other", "Other"],
  ["copywriting", "Copywriting"],
  ["print-project", "Print project"],
  ["ui-design", "UI Design"],
  ["website-design", "Website design"],
];
const previousTasks = [
  ["none", "None"],
  ["email", "Email"],
  ["demo", "Demo"],
  ["lunch", "Lunch"],
  ["meeting", "Meeting"],
  ["follow-up", "Follow-up"],
  ["thank-you", "Thank you"],
  ["ship", "Ship"],
  ["call", "Call"],
];

const isUnchanged = (
  items: { value: string; label: string }[],
  previous: string[][],
) =>
  items.length === previous.length &&
  items.every(
    (item, index) =>
      item.value === previous[index][0] && item.label === previous[index][1],
  );

export function adaptLegacyConfiguration(config: ConfigurationContextValue) {
  return {
    ...config,
    dealStages: isUnchanged(config.dealStages, previousStages)
      ? defaultConfiguration.dealStages
      : config.dealStages,
    dealCategories: isUnchanged(config.dealCategories, previousCategories)
      ? defaultConfiguration.dealCategories
      : config.dealCategories,
    taskTypes: isUnchanged(config.taskTypes, previousTasks)
      ? defaultConfiguration.taskTypes
      : config.taskTypes,
  };
}
