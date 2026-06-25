import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { cva, type VariantProps } from "class-variance-authority";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        outline: "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export function ButtonLink(
  props: {
    href: string;
    children?: unknown;
    class?: string;
  } & VariantProps<typeof buttonVariants>
) {
  const { href, children, class: className, variant, size } = props;
  return (
    <a data-slot="button" href={href} class={cn(buttonVariants({ variant, size }), className)}>
      {children}
    </a>
  );
}

export function Card(props: { children?: unknown; class?: string }) {
  return (
    <div data-slot="card" class={cn("bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm", props.class)}>
      {props.children}
    </div>
  );
}

export function CardHeader(props: { children?: unknown; class?: string }) {
  return (
    <div data-slot="card-header" class={cn("grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6", props.class)}>
      {props.children}
    </div>
  );
}

export function CardTitle(props: { children?: unknown; class?: string }) {
  return (
    <div data-slot="card-title" class={cn("leading-none font-semibold", props.class)}>
      {props.children}
    </div>
  );
}

export function CardDescription(props: { children?: unknown; class?: string }) {
  return (
    <div data-slot="card-description" class={cn("text-muted-foreground text-sm", props.class)}>
      {props.children}
    </div>
  );
}

export function CardContent(props: { children?: unknown; class?: string }) {
  return (
    <div data-slot="card-content" class={cn("px-6", props.class)}>
      {props.children}
    </div>
  );
}

export const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 gap-1 transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export function Badge(props: { children?: unknown; class?: string } & VariantProps<typeof badgeVariants>) {
  const { children, class: className, variant } = props;
  return (
    <span data-slot="badge" class={cn(badgeVariants({ variant }), className)}>
      {children}
    </span>
  );
}

export function Separator(props: { class?: string }) {
  return <div data-slot="separator" role="separator" class={cn("bg-border shrink-0 h-px w-full", props.class)} />;
}
