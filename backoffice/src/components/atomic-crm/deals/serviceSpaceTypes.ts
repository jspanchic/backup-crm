// Stable values are stored in the database; the labels are translated for display.
export const serviceSpaceTypes = [
  "home",
  "office_warehouse",
  "restaurant_kitchen",
  "clinic",
  "veterinary",
  "gym",
  "school_daycare",
  "hotel_rental",
  "other",
] as const;

export const serviceSpaceChoices = serviceSpaceTypes.map((id) => ({
  id,
  name: `resources.deals.service_space_types.${id}`,
}));
