import { GlobalSearchButton } from "../search/GlobalSearchButton";
import { MobileRefreshButton } from "./MobileRefreshButton";

// The search lives here rather than in each screen: there is no Cmd+K on a
// phone, so this header is the only place reachable from every mobile page.
// Refresh only earns its space on the list pages, whose content changes under
// the user; elsewhere it would just crowd the header.
const MobileHeader = ({
  children,
  showRefresh = false,
}: {
  children: React.ReactNode;
  showRefresh?: boolean;
}) => {
  return (
    <header className="fixed top-0 left-0 right-0 z-10 flex h-14 w-full items-center justify-between border-b border-[#1c3349] bg-[#07131f] px-4 text-[#f2fbf8] [&_.text-secondary-foreground]:text-[#f2fbf8]">
      {children}
      <div className="flex items-center [&>button]:text-[#d3e4e2] [&>button:hover]:bg-[#173448]">
        <GlobalSearchButton variant="icon" />
        {showRefresh ? <MobileRefreshButton /> : null}
      </div>
    </header>
  );
};

export default MobileHeader;
