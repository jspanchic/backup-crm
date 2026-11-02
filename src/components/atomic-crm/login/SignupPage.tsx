import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useDataProvider, useLogin, useNotify, useTranslate } from "ra-core";
import { useForm, type SubmitHandler } from "react-hook-form";
import { Navigate, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { CrmDataProvider } from "../providers/types";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { SignUpData } from "../types";
import { LoginSkeleton } from "./LoginSkeleton";
import { Notification } from "@/components/admin/notification";
import { ConfirmationRequired } from "./ConfirmationRequired";
import { SSOAuthButton } from "./SSOAuthButton";
import { googleWorkplaceDomain } from "./authConfig";

export const SignupPage = () => {
  const queryClient = useQueryClient();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { darkModeLogo: logo, title } = useConfigurationContext();
  const navigate = useNavigate();
  const translate = useTranslate();
  const { data: isInitialized, isPending } = useQuery({
    queryKey: ["init"],
    queryFn: async () => {
      return dataProvider.isInitialized();
    },
  });

  const { isPending: isSignUpPending, mutate } = useMutation({
    mutationKey: ["signup"],
    mutationFn: async (data: SignUpData) => {
      return dataProvider.signUp(data);
    },
    onSuccess: (data) => {
      login({
        email: data.email,
        password: data.password,
        redirectTo: "/contacts",
      })
        .then(() => {
          notify("crm.auth.signup.initial_user_created", {
            messageArgs: {
              _: "Initial user successfully created",
            },
          });
          // FIXME: We should probably provide a hook for that in the ra-core package
          queryClient.invalidateQueries({
            queryKey: ["auth", "canAccess"],
          });
        })
        .catch((err) => {
          if (err.code === "email_not_confirmed") {
            // An email confirmation is required to continue.
            navigate(ConfirmationRequired.path);
          } else {
            notify("crm.auth.sign_in_failed", {
              type: "error",
              messageArgs: {
                _: "Failed to log in.",
              },
            });
            navigate("/login");
          }
        });
    },
    onError: (error) => {
      notify(error.message);
    },
  });

  const login = useLogin();
  const notify = useNotify();

  const {
    register,
    handleSubmit,
    formState: { isValid },
  } = useForm<SignUpData>({
    mode: "onChange",
  });

  if (isPending) {
    return <LoginSkeleton />;
  }

  // For the moment, we only allow one user to sign up. Other users must be created by the administrator.
  if (isInitialized) {
    return <Navigate to="/login" />;
  }

  const onSubmit: SubmitHandler<SignUpData> = async (data) => {
    mutate(data);
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
            src={logo}
            alt=""
            className="h-9 w-auto max-w-[140px] object-contain"
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
          <p className="mt-5 max-w-md text-base leading-7 text-slate-300">
            {translate("crm.auth.signup.create_first_user", {
              _: "Create the first user account to complete the setup.",
            })}
          </p>
        </div>
        <div className="relative hidden text-xs tracking-wide text-slate-400 lg:block">
          {title}
        </div>
      </div>
      <div className="flex items-center justify-center rounded-t-[2rem] bg-[#f6f9fa] px-6 py-10 sm:px-10 lg:min-h-screen lg:rounded-none lg:px-12">
        <div className="w-full max-w-md rounded-2xl border border-[#e2eaec] bg-white p-6 shadow-[0_20px_70px_rgba(4,28,43,0.08)] [--input:#d4e1e4] [--muted-foreground:#536d78] [--primary:#007f80] [--primary-foreground:white] [--ring:#008a89] sm:p-9">
          <div className="mb-7">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#087f80]">
              {title}
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-[#102d3a]">
              {translate("crm.auth.signup.create_account", {
                _: "Create account",
              })}
            </h2>
          </div>
          <p className="mb-6 text-sm leading-6 text-[#536d78]">
            {translate("crm.auth.signup.create_first_user", {
              _: "Create the first user account to complete the setup.",
            })}
          </p>
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4 text-[#183640]"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="first_name">
                {translate("crm.auth.first_name")}
              </Label>
              <Input
                {...register("first_name", { required: true })}
                id="first_name"
                type="text"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="last_name">
                {translate("crm.auth.last_name")}
              </Label>
              <Input
                {...register("last_name", { required: true })}
                id="last_name"
                type="text"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{translate("ra.auth.email")}</Label>
              <Input
                {...register("email", { required: true })}
                id="email"
                type="email"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">{translate("ra.auth.password")}</Label>
              <Input
                {...register("password", { required: true })}
                id="password"
                type="password"
                required
              />
            </div>
            <div className="flex flex-col gap-4 justify-between items-center mt-8">
              <Button
                type="submit"
                disabled={!isValid || isSignUpPending}
                className="h-11 w-full rounded-lg bg-[#007f80] font-semibold text-white hover:bg-[#006b6d]"
              >
                {isSignUpPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    {translate("crm.auth.signup.creating", {
                      _: "Creating...",
                    })}
                  </>
                ) : (
                  translate("crm.auth.signup.create_account", {
                    _: "Create account",
                  })
                )}
              </Button>
              {googleWorkplaceDomain ? (
                <SSOAuthButton
                  className="w-full"
                  domain={googleWorkplaceDomain}
                >
                  {translate("crm.auth.sign_in_google_workspace", {
                    _: "Sign in with Google Workplace",
                  })}
                </SSOAuthButton>
              ) : null}
            </div>
          </form>
        </div>
      </div>
      <Notification />
    </div>
  );
};

SignupPage.path = "/sign-up";
