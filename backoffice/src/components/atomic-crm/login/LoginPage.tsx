import { useEffect, useRef, useState } from "react";
import { Form, required, useLogin, useNotify, useTranslate } from "ra-core";
import type { SubmitHandler, FieldValues } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/admin/text-input";
import { Notification } from "@/components/admin/notification";
import { useConfigurationContext } from "@/components/atomic-crm/root/ConfigurationContext.tsx";
import { SSOAuthButton } from "./SSOAuthButton";
import {
  disableEmailPasswordAuthentication,
  googleWorkplaceDomain,
} from "./authConfig";

/**
 * Login page displayed when authentication is enabled and the user is not authenticated.
 *
 * Automatically shown when an unauthenticated user tries to access a protected route.
 * Handles login via authProvider.login() and displays error notifications on failure.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/loginpage LoginPage documentation}
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/security Security documentation}
 */
export const LoginPage = (props: { redirectTo?: string }) => {
  const { darkModeLogo, title } = useConfigurationContext();
  const { redirectTo } = props;
  const [loading, setLoading] = useState(false);
  const hasDisplayedRecoveryNotification = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const login = useLogin();
  const notify = useNotify();
  const translate = useTranslate();

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const shouldNotify = searchParams.get("passwordRecoveryEmailSent") === "1";

    if (!shouldNotify || hasDisplayedRecoveryNotification.current) {
      return;
    }

    hasDisplayedRecoveryNotification.current = true;
    notify("crm.auth.recovery_email_sent", {
      type: "success",
      messageArgs: {
        _: "If you're a registered user, you should receive a password recovery email shortly.",
      },
    });

    searchParams.delete("passwordRecoveryEmailSent");
    const nextSearch = searchParams.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
      },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate, notify]);

  const handleSubmit: SubmitHandler<FieldValues> = (values) => {
    setLoading(true);
    login(values, redirectTo)
      .then(() => {
        setLoading(false);
      })
      .catch((error) => {
        setLoading(false);
        notify(
          typeof error === "string"
            ? error
            : typeof error === "undefined" || !error.message
              ? "ra.auth.sign_in_error"
              : error.message,
          {
            type: "error",
            messageArgs: {
              _:
                typeof error === "string"
                  ? error
                  : error && error.message
                    ? error.message
                    : undefined,
            },
          },
        );
      });
  };

  return (
    <div className="min-h-screen bg-[#071a2a] lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(460px,0.8fr)]">
      <div className="relative overflow-hidden px-6 py-8 text-white sm:px-10 lg:flex lg:min-h-screen lg:flex-col lg:justify-between lg:px-14 lg:py-12 xl:px-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 top-1/3 h-80 w-80 rounded-full bg-[#00c5bd]/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-28 bottom-0 h-96 w-96 rounded-full bg-[#0d6986]/20 blur-3xl"
        />
        <div className="relative flex items-center gap-3">
          <img
            className="h-9 w-auto max-w-[140px] object-contain"
            src={darkModeLogo}
            alt=""
          />
          <span className="text-lg font-semibold tracking-tight">{title}</span>
        </div>
        <div className="relative hidden max-w-xl lg:block">
          <div className="mb-6 h-1 w-14 rounded-full bg-[#24d5c5]" />
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#59dfd4]">
            CRM
          </p>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.15] tracking-tight xl:text-5xl">
            {title}
          </h1>
        </div>
        <div className="relative hidden text-xs tracking-wide text-slate-400 lg:block">
          {title}
        </div>
      </div>
      <div className="flex items-center justify-center rounded-t-[2rem] bg-[#f6f9fa] px-6 py-10 sm:px-10 lg:min-h-screen lg:rounded-none lg:px-12">
        <div className="w-full max-w-md space-y-6 rounded-2xl border border-[#e2eaec] bg-white p-6 text-[#183640] shadow-[0_20px_70px_rgba(4,28,43,0.08)] [--input:#d4e1e4] [--muted-foreground:#536d78] [--primary:#007f80] [--primary-foreground:white] [--ring:#008a89] sm:p-9">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#087f80]">
              {title}
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-[#102d3a]">
              {translate("ra.auth.sign_in")}
            </h2>
          </div>
          {disableEmailPasswordAuthentication ? null : (
            <Form className="space-y-8" onSubmit={handleSubmit}>
              <TextInput
                label="ra.auth.email"
                source="email"
                type="email"
                validate={required()}
              />
              <TextInput
                label="ra.auth.password"
                source="password"
                type="password"
                validate={required()}
              />
              <div className="flex flex-col gap-4">
                <Button
                  type="submit"
                  className="h-11 cursor-pointer rounded-lg bg-[#007f80] font-semibold text-white hover:bg-[#006b6d]"
                  disabled={loading}
                >
                  {translate("ra.auth.sign_in")}
                </Button>
              </div>
            </Form>
          )}
          {googleWorkplaceDomain ? (
            <SSOAuthButton className="w-full" domain={googleWorkplaceDomain}>
              {translate("crm.auth.sign_in_google_workspace", {
                _: "Sign in with Google Workplace",
              })}
            </SSOAuthButton>
          ) : null}
          {disableEmailPasswordAuthentication ? null : (
            <Link
              to={"/forgot-password"}
              className="block text-sm text-center text-[#087f80] hover:underline"
            >
              {translate("ra-supabase.auth.forgot_password", {
                _: "Forgot password?",
              })}
            </Link>
          )}
        </div>
      </div>
      <Notification />
    </div>
  );
};
