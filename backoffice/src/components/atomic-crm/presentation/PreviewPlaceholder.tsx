import type { ComponentType, ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { NEXT_DELIVERY } from "./presentationMode";

/**
 * An empty preview: the section exists and can be opened, but it loads nothing. One line says what it will do, and
 * the buttons that would create data are disabled and say when they arrive.
 */
export const PreviewPlaceholder = ({
  icon: Icon,
  title,
  description,
  actions = [],
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  actions?: string[];
  children?: ReactNode;
}) => (
  <div
    className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center"
    data-testid="preview-placeholder"
  >
    <Icon className="h-10 w-10 text-muted-foreground" />
    <h3 className="text-base font-semibold">{title}</h3>
    <p className="max-w-xl text-sm text-muted-foreground">{description}</p>
    {actions.length > 0 && (
      <div className="flex flex-wrap items-center justify-center gap-2">
        {actions.map((label) => (
          <Button key={label} variant="outline" disabled title={NEXT_DELIVERY}>
            {label}
          </Button>
        ))}
        <span className="text-xs text-muted-foreground">{NEXT_DELIVERY}</span>
      </div>
    )}
    {children}
  </div>
);
