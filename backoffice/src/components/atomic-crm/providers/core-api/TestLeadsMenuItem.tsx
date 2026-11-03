import { FlaskConical } from "lucide-react";
import { useRefresh, useTranslate, useUserMenu } from "ra-core";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

import { setShowTestLeads, useShowTestLeads } from "./testLeads";

/** User-menu item that shows or hides the test leads ("Prueba X") in lists, board and dashboard. */
export const TestLeadsMenuItem = () => {
  const translate = useTranslate();
  const refresh = useRefresh();
  const userMenuContext = useUserMenu();
  const show = useShowTestLeads();

  return (
    <DropdownMenuItem
      onClick={() => {
        setShowTestLeads(!show);
        userMenuContext?.onClose();
        refresh();
      }}
    >
      <FlaskConical />
      {translate(
        show ? "crm.header.hide_test_leads" : "crm.header.show_test_leads",
      )}
    </DropdownMenuItem>
  );
};
