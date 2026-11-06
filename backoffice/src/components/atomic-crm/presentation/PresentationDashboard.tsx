import { CheckSquare, Inbox, KanbanSquare } from "lucide-react";
import { useGetList } from "ra-core";
import { Link } from "react-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { TasksListContent } from "../tasks/TasksListContent";
import { AddTask } from "../tasks/AddTask";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const money = (value: number) =>
  new Intl.NumberFormat("es-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);

const shortDate = (value: string) =>
  new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(
    new Date(value),
  );

/** The home of the presentation: deals by stage, new inquiries of the week and pending tasks. Read only. */
export const PresentationDashboard = () => {
  const { dealStages } = useConfigurationContext();
  const { data: deals = [], isPending } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "created_at", order: "DESC" },
    filter: { "archived_at@is": null },
  });

  if (isPending) return null;

  const known = new Set(dealStages.map((stage) => stage.value));
  const stageOf = (deal: Deal) =>
    known.has(deal.stage) ? deal.stage : dealStages[0].value;
  const byStage = dealStages.map((stage) => {
    const inStage = deals.filter((deal) => stageOf(deal) === stage.value);
    return {
      ...stage,
      count: inStage.length,
      total: inStage.reduce((sum, deal) => sum + (Number(deal.amount) || 0), 0),
    };
  });
  const since = Date.now() - WEEK_MS;
  const newThisWeek = deals.filter(
    (deal) => new Date(deal.created_at).getTime() >= since,
  );

  return (
    <div className="mt-1 grid grid-cols-1 gap-6 md:grid-cols-12">
      <Card className="md:col-span-5">
        <CardHeader className="flex flex-row items-center gap-2">
          <KanbanSquare className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Negocios por etapa</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-3">
            {byStage.map((stage) => (
              <li key={stage.value} className="flex items-center gap-3">
                <span className="flex-1 text-sm font-medium">{stage.label}</span>
                <span className="text-sm text-muted-foreground">
                  {stage.total ? money(stage.total) : "—"}
                </span>
                <span className="min-w-8 rounded-full bg-primary/10 px-2 py-0.5 text-center text-sm font-semibold text-primary">
                  {stage.count}
                </span>
              </li>
            ))}
          </ul>
          <Link
            to="/deals"
            className="mt-4 inline-block text-sm text-primary hover:underline"
          >
            Ver el tablero
          </Link>
        </CardContent>
      </Card>

      <Card className="md:col-span-4">
        <CardHeader className="flex flex-row items-center gap-2">
          <Inbox className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="flex-1 text-lg">
            Nuevas consultas de la semana
          </CardTitle>
          <span className="text-3xl font-bold text-primary">
            {newThisWeek.length}
          </span>
        </CardHeader>
        <CardContent>
          {newThisWeek.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no hay consultas esta semana.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {newThisWeek.slice(0, 6).map((deal) => (
                <li key={deal.id}>
                  <Link
                    to={`/deals/${deal.id}/show`}
                    className="flex items-baseline gap-2 text-sm no-underline hover:underline"
                  >
                    <span className="flex-1 truncate">{deal.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {shortDate(deal.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-3">
        <CardHeader className="flex flex-row items-center gap-2">
          <CheckSquare className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="flex-1 text-lg">Tareas pendientes</CardTitle>
          <AddTask display="icon" selectContact />
        </CardHeader>
        <CardContent>
          <TasksListContent />
        </CardContent>
      </Card>
    </div>
  );
};
