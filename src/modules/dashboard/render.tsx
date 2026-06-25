import { renderToString } from "hono/jsx/dom/server";
import { Badge, ButtonLink, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator } from "./ui";

export interface DashboardStatusInput {
  instanceId: string;
  startedAt: Date;
  url: string;
  host: string;
  port: number;
  cwd: string;
  projectTrusted: boolean;
  sessionFile?: string;
  debug: boolean;
  enabled: boolean;
  modules: {
    dcp: boolean;
    dashboard: boolean;
  };
  globalDatabasePath: string;
  projectDatabasePath?: string;
}

export interface DashboardStatusPayload {
  dashboard: {
    instanceId: string;
    startedAt: string;
    url: string;
    host: string;
    port: number;
  };
  session: {
    cwd: string;
    projectTrusted: boolean;
    sessionFile?: string;
  };
  runtime: {
    debug: boolean;
    enabled: boolean;
    modules: {
      dcp: boolean;
      dashboard: boolean;
    };
  };
  database: {
    global: {
      path: string;
    };
    project?: {
      path: string;
    };
  };
}

export function createDashboardStatus(input: DashboardStatusInput): DashboardStatusPayload {
  return {
    dashboard: {
      instanceId: input.instanceId,
      startedAt: input.startedAt.toISOString(),
      url: input.url,
      host: input.host,
      port: input.port,
    },
    session: {
      cwd: input.cwd,
      projectTrusted: input.projectTrusted,
      ...(input.sessionFile ? { sessionFile: input.sessionFile } : {}),
    },
    runtime: {
      debug: input.debug,
      enabled: input.enabled,
      modules: { ...input.modules },
    },
    database: {
      global: { path: input.globalDatabasePath },
      ...(input.projectDatabasePath ? { project: { path: input.projectDatabasePath } } : {}),
    },
  };
}

export function renderDashboardHtml(status: DashboardStatusPayload): string {
  return `<!doctype html>\n${renderToString(<DashboardPage status={status} />)}`;
}

function DashboardPage(props: { status: DashboardStatusPayload }) {
  const { status } = props;
  const projectDatabase = status.database.project?.path ?? "Not available for this project";

  return (
    <html lang="en" class="dark">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Pi Ext Dashboard</title>
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        <style {...tailwindStyleAttributes}>{tailwindTheme}</style>
      </head>
      <body class="min-h-screen bg-background text-foreground antialiased">
        <main class="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10 lg:px-8">
          <header class="flex flex-col gap-6 rounded-3xl border bg-card px-6 py-8 shadow-sm lg:px-8">
            <div class="flex flex-col gap-3">
              <Badge variant="secondary" class="uppercase tracking-[0.24em]">
                Local Pi extension server
              </Badge>
              <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div class="flex max-w-3xl flex-col gap-3">
                  <h1 class="text-4xl font-semibold tracking-[-0.06em] text-balance sm:text-6xl">Pi Ext Dashboard</h1>
                  <p class="text-muted-foreground text-base leading-7 sm:text-lg">
                    Placeholder local dashboard for extension runtime, storage paths, and future global/project DCP statistics.
                  </p>
                </div>
                <div class="flex flex-wrap gap-3">
                  <ButtonLink href="/api/status" variant="outline">
                    JSON status
                  </ButtonLink>
                  <ButtonLink href="/healthz" variant="secondary">
                    Health check
                  </ButtonLink>
                </div>
              </div>
            </div>
            <Separator />
            <div class="grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
              <Pill label="Host" value={status.dashboard.host} />
              <Pill label="Port" value={String(status.dashboard.port)} />
              <Pill label="Started" value={status.dashboard.startedAt} />
            </div>
          </header>

          <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <DashboardCard title="Instance" description="Current dashboard process id" value={status.dashboard.instanceId} />
            <DashboardCard title="Server URL" description="Browser target for this run" value={status.dashboard.url} />
            <DashboardCard title="Project" description="Active Pi working directory" value={status.session.cwd} />
            <DashboardCard title="Trust" description="Project-local storage availability" value={status.session.projectTrusted ? "trusted" : "untrusted"} />
            <DashboardCard title="Global database" description="Shared extension SQLite store" value={status.database.global.path} />
            <DashboardCard title="Project database" description="Trusted project SQLite store" value={projectDatabase} />
            <DashboardCard title="DCP module" description="Compression/data collection module" value={status.runtime.modules.dcp ? "enabled" : "disabled"} />
            <DashboardCard title="Dashboard module" description="Local web UI module" value={status.runtime.modules.dashboard ? "enabled" : "disabled"} />
          </section>
        </main>
      </body>
    </html>
  );
}

function DashboardCard(props: { title: string; description: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle class="text-sm">{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p class="break-words font-mono text-sm leading-6 text-card-foreground">{props.value}</p>
      </CardContent>
    </Card>
  );
}

function Pill(props: { label: string; value: string }) {
  return (
    <div class="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2">
      <span class="text-muted-foreground">{props.label}</span>
      <span class="truncate font-mono text-foreground">{props.value}</span>
    </div>
  );
}

const tailwindStyleAttributes: Record<string, string> = { type: "text/tailwindcss" };

const tailwindTheme = String.raw`
@custom-variant dark (&:is(.dark *));

:root {
  --background: oklch(0.985 0.004 95.277);
  --foreground: oklch(0.18 0.02 95.277);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.18 0.02 95.277);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.18 0.02 95.277);
  --primary: oklch(0.23 0.025 95.277);
  --primary-foreground: oklch(0.985 0.004 95.277);
  --secondary: oklch(0.94 0.012 95.277);
  --secondary-foreground: oklch(0.23 0.025 95.277);
  --muted: oklch(0.94 0.012 95.277);
  --muted-foreground: oklch(0.48 0.025 95.277);
  --accent: oklch(0.9 0.03 86.0);
  --accent-foreground: oklch(0.23 0.025 95.277);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.88 0.014 95.277);
  --input: oklch(0.88 0.014 95.277);
  --ring: oklch(0.72 0.08 86.0);
  --radius: 0.75rem;
}

.dark {
  --background: oklch(0.13 0.015 95.277);
  --foreground: oklch(0.94 0.012 95.277);
  --card: oklch(0.18 0.018 95.277);
  --card-foreground: oklch(0.94 0.012 95.277);
  --popover: oklch(0.18 0.018 95.277);
  --popover-foreground: oklch(0.94 0.012 95.277);
  --primary: oklch(0.86 0.11 86.0);
  --primary-foreground: oklch(0.17 0.018 95.277);
  --secondary: oklch(0.25 0.018 95.277);
  --secondary-foreground: oklch(0.94 0.012 95.277);
  --muted: oklch(0.25 0.018 95.277);
  --muted-foreground: oklch(0.72 0.025 95.277);
  --accent: oklch(0.3 0.025 95.277);
  --accent-foreground: oklch(0.94 0.012 95.277);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 12%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.66 0.12 86.0);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}
`;
