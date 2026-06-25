import { renderToString } from "hono/jsx/dom/server";
import { Badge, ButtonLink, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator, cn } from "./ui";
import type { DashboardMemoriesPayload, DashboardMemoryRecord, DashboardMemoryScope } from "./memories";
import { tailwindStyleAttributes, tailwindTheme } from "./render";

const scopeLabels: Record<DashboardMemoryScope, string> = {
  combined: "Combined",
  global: "Global",
  project: "Project",
  session: "Session",
};

export function renderDashboardMemoriesHtml(payload: DashboardMemoriesPayload): string {
  return `<!doctype html>\n${renderToString(<DashboardMemoriesPage payload={payload} />)}`;
}

function DashboardMemoriesPage(props: { payload: DashboardMemoriesPayload }) {
  const { payload } = props;

  return (
    <html lang="en" class="dark">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Stored memories · Pi Ext Dashboard</title>
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
                  <h1 class="text-4xl font-semibold tracking-[-0.06em] text-balance sm:text-6xl">Stored memories</h1>
                  <p class="text-muted-foreground text-base leading-7 sm:text-lg">
                    Browse saved global, project, and current-session memories that Pi can inject into prompts.
                  </p>
                </div>
                <div class="flex flex-wrap gap-3">
                  <ButtonLink href="/" variant="outline">
                    Dashboard home
                  </ButtonLink>
                  <ButtonLink href={apiHref(payload.selectedScope)} variant="secondary">
                    JSON memories
                  </ButtonLink>
                </div>
              </div>
            </div>
            <Separator />
            <nav class="flex flex-wrap gap-2" aria-label="Memory scopes">
              {(["combined", "global", "project", "session"] as DashboardMemoryScope[]).map((scope) => (
                <ScopeLink scope={scope} selectedScope={payload.selectedScope} count={payload.counts[scope]} />
              ))}
            </nav>
          </header>

          {payload.visibleMemories.length > 0 ? (
            <section class="grid gap-4 lg:grid-cols-2">
              {payload.visibleMemories.map((memory) => <MemoryCard memory={memory} />)}
            </section>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>No memories found</CardTitle>
                <CardDescription>There are no stored memories in this scope yet.</CardDescription>
              </CardHeader>
            </Card>
          )}
        </main>
      </body>
    </html>
  );
}

function ScopeLink(props: { scope: DashboardMemoryScope; selectedScope: DashboardMemoryScope; count: number }) {
  const href = props.scope === "combined" ? "/memories" : `/memories/${props.scope}`;
  const selected = props.scope === props.selectedScope;
  return (
    <a
      href={href}
      class={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
        selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-accent",
      )}
      aria-current={selected ? "page" : undefined}
    >
      <span>{scopeLabels[props.scope]}</span>
      <span class={cn("rounded-full px-2 py-0.5 text-xs", selected ? "bg-primary-foreground/15" : "bg-muted text-muted-foreground")}>{props.count}</span>
    </a>
  );
}

function MemoryCard(props: { memory: DashboardMemoryRecord }) {
  const { memory } = props;
  const title = memory.title ?? firstLine(memory.content);
  return (
    <Card>
      <CardHeader>
        <div class="flex flex-wrap items-center gap-2">
          <Badge variant="outline" class="capitalize">
            {memory.scope}
          </Badge>
          <span class="text-muted-foreground text-xs">Importance {memory.importance}/5</span>
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{formatMemoryDate(memory.createdAt)}</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <p class="whitespace-pre-wrap text-sm leading-6 text-card-foreground">{memory.content}</p>
        {memory.tags.length > 0 ? (
          <div class="flex flex-wrap gap-2">
            {memory.tags.map((tag) => (
              <Badge variant="secondary">{tag}</Badge>
            ))}
          </div>
        ) : undefined}
        {memory.sessionId ? <p class="break-all font-mono text-xs text-muted-foreground">Session: {memory.sessionId}</p> : undefined}
      </CardContent>
    </Card>
  );
}

function apiHref(scope: DashboardMemoryScope): string {
  return scope === "combined" ? "/api/memories" : `/api/memories/${scope}`;
}

function firstLine(content: string): string {
  return content.split(/\r?\n/, 1)[0] || "Untitled memory";
}

function formatMemoryDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
