import {
  Building2,
  CalendarDays,
  FileText,
  Handshake,
  Import,
  LayoutDashboard,
  Settings,
  User,
  Users,
} from "lucide-react";
import { CanAccess, useTranslate, useUserMenu } from "ra-core";
import { Link, matchPath, useLocation } from "react-router";
import { RefreshButton } from "@/components/admin/refresh-button";
import { ThemeModeToggle } from "@/components/admin/theme-mode-toggle";
import { UserMenu } from "@/components/admin/user-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

import { useConfigurationContext } from "../root/ConfigurationContext";
import { ImportPage } from "../misc/ImportPage";
import { ChangelogPage } from "../misc/ChangelogPage";
import { GlobalSearchButton } from "../search/GlobalSearchButton";
import { isCoreApiProvider } from "../providers/core-api";
import { TestLeadsMenuItem } from "../providers/core-api/TestLeadsMenuItem";

const Header = () => {
  const { darkModeLogo, lightModeLogo, title } = useConfigurationContext();
  const location = useLocation();
  const translate = useTranslate();

  let currentPath: string | boolean = "/";
  if (matchPath("/", location.pathname)) {
    currentPath = "/";
  } else if (matchPath("/contacts/*", location.pathname)) {
    currentPath = "/contacts";
  } else if (matchPath("/companies/*", location.pathname)) {
    currentPath = "/companies";
  } else if (matchPath("/deals/*", location.pathname)) {
    currentPath = "/deals";
  } else if (matchPath("/appointments/*", location.pathname)) {
    currentPath = "/appointments";
  } else {
    currentPath = false;
  }

  return (
    <>
      <nav className="grow">
        <header className="border-b border-[#1c3349] bg-[#07131f] text-[#f2fbf8] shadow-[0_10px_30px_rgba(2,12,20,0.12)]">
          <div className="mx-auto max-w-[1600px] px-4 lg:px-6">
            <div className="flex min-h-18 items-center justify-between gap-3">
              <Link
                to="/"
                className="flex shrink-0 items-center gap-2.5 text-[#f2fbf8] no-underline"
              >
                <img
                  className="[.light_&]:hidden h-8 w-8 object-contain"
                  src={darkModeLogo}
                  alt={title}
                />
                <img
                  className="[.dark_&]:hidden h-8 w-8 object-contain"
                  src={lightModeLogo}
                  alt={title}
                />
                <h1 className="hidden whitespace-nowrap text-base font-bold tracking-tight xl:block">
                  {title}
                </h1>
              </Link>
              <div className="min-w-0">
                <nav
                  className="flex items-center gap-1"
                  aria-label={translate("crm.navigation.label", {
                    _: "Main navigation",
                  })}
                >
                  <NavigationTab
                    label={translate("ra.page.dashboard")}
                    to="/"
                    isActive={currentPath === "/"}
                    Icon={LayoutDashboard}
                  />
                  <NavigationTab
                    label={translate("resources.contacts.name", {
                      smart_count: 2,
                    })}
                    to="/contacts"
                    isActive={currentPath === "/contacts"}
                    Icon={Users}
                  />
                  <NavigationTab
                    label={translate("resources.companies.name", {
                      smart_count: 2,
                    })}
                    to="/companies"
                    isActive={currentPath === "/companies"}
                    Icon={Building2}
                  />
                  <NavigationTab
                    label={translate("resources.deals.name", {
                      smart_count: 2,
                    })}
                    to="/deals"
                    isActive={currentPath === "/deals"}
                    Icon={Handshake}
                  />
                  <NavigationTab
                    label={translate("resources.appointments.name", {
                      smart_count: 2,
                    })}
                    to="/appointments"
                    isActive={currentPath === "/appointments"}
                    Icon={CalendarDays}
                  />
                </nav>
              </div>
              <div className="flex shrink-0 items-center gap-0.5 [&>button]:text-[#d3e4e2] [&>button:hover]:bg-[#173448] [&>button:first-child]:border-[#294255] [&>button:first-child]:bg-[#11263b] [&_kbd]:border-[#294255] [&_kbd]:bg-[#1c3349] [&_kbd]:text-[#d3e4e2]">
                <GlobalSearchButton />
                <ThemeModeToggle />
                <RefreshButton />
                <UserMenu>
                  <ProfileMenu />
                  <CanAccess resource="sales" action="list">
                    <UsersMenu />
                  </CanAccess>
                  <CanAccess resource="configuration" action="edit">
                    <SettingsMenu />
                  </CanAccess>
                  {isCoreApiProvider() && <TestLeadsMenuItem />}
                  <ImportFromJsonMenuItem />
                  <ChangelogMenuItem />
                </UserMenu>
              </div>
            </div>
          </div>
        </header>
      </nav>
    </>
  );
};

const NavigationTab = ({
  label,
  to,
  isActive,
  Icon,
}: {
  label: string;
  to: string;
  isActive: boolean;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}) => (
  <Link
    to={to}
    aria-current={isActive ? "page" : undefined}
    className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors lg:px-3 ${
      isActive
        ? "bg-[#2fc9a0]/15 text-[#65e5c2]"
        : "text-[#a9bdc0] hover:bg-[#11263b] hover:text-[#f2fbf8]"
    }`}
  >
    <Icon className="hidden h-4 w-4 xl:block" aria-hidden="true" />
    {label}
  </Link>
);

const UsersMenu = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<UsersMenu> must be used inside <UserMenu?");
  }
  return (
    <DropdownMenuItem
      onClick={userMenuContext.onClose}
      render={<Link to="/sales" className="flex items-center gap-2" />}
    >
      <Users />
      {translate("resources.sales.name", { smart_count: 2 })}
    </DropdownMenuItem>
  );
};

const ProfileMenu = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<ProfileMenu> must be used inside <UserMenu?");
  }
  return (
    <DropdownMenuItem
      onClick={userMenuContext.onClose}
      render={<Link to="/profile" className="flex items-center gap-2" />}
    >
      <User />
      {translate("crm.profile.title")}
    </DropdownMenuItem>
  );
};

const SettingsMenu = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<SettingsMenu> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem
      onClick={userMenuContext.onClose}
      render={<Link to="/settings" className="flex items-center gap-2" />}
    >
      <Settings />
      {translate("crm.settings.title")}
    </DropdownMenuItem>
  );
};

const ImportFromJsonMenuItem = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<ImportFromJsonMenuItem> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem
      onClick={userMenuContext.onClose}
      render={<Link to={ImportPage.path} className="flex items-center gap-2" />}
    >
      <Import />
      {translate("crm.header.import_data")}
    </DropdownMenuItem>
  );
};

const ChangelogMenuItem = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<ChangelogMenuItem> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem
      onClick={userMenuContext.onClose}
      render={
        <Link to={ChangelogPage.path} className="flex items-center gap-2" />
      }
    >
      <FileText />
      {translate("crm.changelog.title")}
    </DropdownMenuItem>
  );
};
export default Header;
