import { ResponsiveBar } from "@nivo/bar";
import { CheckSquare, Inbox, KanbanSquare, LineChart } from "lucide-react";
import { useGetList, useGetMany } from "ra-core";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { AddTask } from "../tasks/AddTask";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Contact, Deal, Task } from "../types";
import { formatUsd as money } from "./money";

const DAY_MS = 24 * 60 * 60 * 1000;
const BRAND = "#0098c4";
const CHART_THEME = {
  text: { fill: "var(--color-muted-foreground)", fontSize: 12 },
  grid: { line: { stroke: "var(--color-border)" } },
  axis: { ticks: { text: { fill: "var(--color-muted-foreground)" } } },
};

const localDay = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

const shortDate = (value: string | Date) =>
  new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(
    new Date(value),
  );

const Kpi = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) => (
  <Card className="gap-1 py-4">
    <CardContent className="flex flex-col gap-1 px-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-3xl font-bold text-primary">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </CardContent>
  </Card>
);

/**
 * The home of the presentation. Everything is calculated from the opportunities and tasks in the database: nothing
 * here is a number written in the code. Read only.
 */
export const PresentationDashboard = () => {
  const { dealStages } = useConfigurationContext();
  const { data: deals = [], isPending } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "created_at", order: "DESC" },
    filter: { "archived_at@is": null },
  });
  const { data: tasks = [] } = useGetList<Task>("tasks", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "due_date", order: "ASC" },
    filter: { "done_date@is": null },
  });
  const pending = tasks.slice(0, 6);
  const { data: contacts = [] } = useGetMany<Contact>(
    "contacts",
    { ids: pending.map((task) => task.contact_id) },
    { enabled: pending.length > 0 },
  );

  if (isPending) return null;

  const now = Date.now();
  const known = new Set(dealStages.map((stage) => stage.value));
  const stageOf = (deal: Deal) =>
    known.has(deal.stage) ? deal.stage : dealStages[0].value;
  const amountOf = (deal: Deal) => Number(deal.amount) || 0;

  const byStage = dealStages.map((stage) => {
    const inStage = deals.filter((deal) => stageOf(deal) === stage.value);
    return {
      stage: stage.label,
      count: inStage.length,
      total: inStage.reduce((sum, deal) => sum + amountOf(deal), 0),
    };
  });

  const newThisWeek = deals.filter(
    (deal) => now - new Date(deal.created_at).getTime() < 7 * DAY_MS,
  );
  const quoted = deals.filter((deal) => amountOf(deal) > 0);
  const inProgress = deals
    .filter((deal) => !["won", "lost"].includes(deal.stage))
    .reduce((sum, deal) => sum + amountOf(deal), 0);
  const rate = deals.length ? (quoted.length / deals.length) * 100 : 0;
  const average = quoted.length
    ? quoted.reduce((sum, deal) => sum + amountOf(deal), 0) / quoted.length
    : 0;

  const perDay = Array.from({ length: 14 }, (_, index) => {
    const day = new Date(now - (13 - index) * DAY_MS);
    const key = localDay(day);
    return {
      day: shortDate(day),
      consultas: deals.filter(
        (deal) => localDay(new Date(deal.created_at)) === key,
      ).length,
    };
  });

  const contactName = (task: Task) => {
    const contact = contacts.find((entry) => entry.id === task.contact_id);
    return contact
      ? `${contact.first_name} ${contact.last_name ?? ""}`.trim()
      : "";
  };
  const dueLabel = (task: Task) => {
    const due = new Date(task.due_date);
    return due.getTime() < now ? `Vencida · ${shortDate(due)}` : shortDate(due);
  };

  return (
    <div className="mt-1 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Inicio</h2>
        <Badge variant="outline" className="text-muted-foreground">
          Datos de prueba
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Consultas nuevas" value={String(newThisWeek.length)} hint="Últimos 7 días" />
        <Kpi label="Oportunidades cotizadas" value={String(quoted.length)} hint="Con monto calculado" />
        <Kpi label="Monto en curso" value={money(inProgress)} hint="Sin ganadas ni perdidas" />
        <Kpi label="Consulta → cotizado" value={`${Math.round(rate)}%`} hint={`${quoted.length} de ${deals.length} oportunidades`} />
        <Kpi label="Ticket promedio" value={money(Math.round(average))} hint="De las cotizadas" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <KanbanSquare className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="flex-1 text-lg">Embudo por etapa</CardTitle>
            <Link to="/deals" className="text-sm text-primary hover:underline">
              Ver el tablero
            </Link>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveBar
              data={[...byStage].reverse()}
              indexBy="stage"
              keys={["count"]}
              layout="horizontal"
              colors={[BRAND]}
              margin={{ top: 8, right: 130, bottom: 24, left: 110 }}
              padding={0.35}
              enableGridY={false}
              enableLabel={false}
              axisBottom={null}
              axisLeft={{ tickSize: 0, tickPadding: 10 }}
              theme={CHART_THEME}
              tooltip={({ data }) => (
                <div className="rounded bg-secondary p-2 text-sm text-secondary-foreground shadow">
                  <strong>{String(data.stage)}</strong>: {String(data.count)}
                  {Number(data.total) > 0 ? ` · ${money(Number(data.total))}` : ""}
                </div>
              )}
              layers={[
                "grid",
                "axes",
                "bars",
                ({ bars }) => (
                  <g>
                    {bars.map((bar) => (
                      <text
                        key={bar.key}
                        x={bar.x + bar.width + 8}
                        y={bar.y + bar.height / 2}
                        dominantBaseline="middle"
                        fontSize={12}
                        fill="var(--color-foreground)"
                      >
                        {`${bar.data.data.count}${Number(bar.data.data.total) > 0 ? ` · ${money(Number(bar.data.data.total))}` : ""}`}
                      </text>
                    ))}
                  </g>
                ),
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <LineChart className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="flex-1 text-lg">
              Consultas por día · 14 días
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveBar
              data={perDay}
              indexBy="day"
              keys={["consultas"]}
              colors={[BRAND]}
              margin={{ top: 12, right: 8, bottom: 40, left: 28 }}
              padding={0.3}
              enableLabel={false}
              enableGridY
              axisLeft={{ tickSize: 0, tickPadding: 6, tickValues: 4 }}
              axisBottom={{ tickSize: 0, tickPadding: 8, tickRotation: -40 }}
              theme={CHART_THEME}
              tooltip={({ indexValue, value }) => (
                <div className="rounded bg-secondary p-2 text-sm text-secondary-foreground shadow">
                  <strong>{indexValue}</strong>: {value}
                </div>
              )}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <CheckSquare className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="flex-1 text-lg">
            Tareas pendientes y vencidas
          </CardTitle>
          <AddTask display="icon" selectContact />
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Inbox className="h-4 w-4" /> No hay tareas pendientes.
            </p>
          ) : (
            <ul className="divide-y">
              {pending.map((task) => (
                <li key={task.id} className="flex items-baseline gap-3 py-2 text-sm">
                  <span className="flex-1 truncate">{task.text}</span>
                  <span className="text-muted-foreground">{contactName(task)}</span>
                  <span
                    className={
                      new Date(task.due_date).getTime() < now
                        ? "font-medium text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {dueLabel(task)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
