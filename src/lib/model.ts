export const PRODUCT = import.meta.env.VITE_PRODUCT_NAME || "ContentOS";
export const platforms = [
  "LinkedIn",
  "Instagram",
  "X",
  "YouTube",
  "Telegram",
] as const;
export type Platform = (typeof platforms)[number];
export type Status =
  | "DRAFT"
  | "NEEDS_REVIEW"
  | "APPROVED"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED"
  | "UNCERTAIN";
export interface Post {
  id: string;
  title: string;
  body: string;
  variants: Partial<Record<Platform, string>> & {
    mediaType?: "text" | "image" | "video";
    mediaUrl?: string;
    [key: string]: any;
  };
  platforms: Platform[];
  status: Status;
  createdAt: string;
  scheduledAt?: string;
  timezone?: string;
  creator: string;
  version: number;
}
export interface Account {
  id: string;
  platform: Platform;
  name: string;
  state: string;
  lastSync?: string;
}
export interface Activity {
  id: string;
  actor: string;
  action: string;
  entity: string;
  at: string;
}
export interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
}
export interface Brand {
  name: string;
  website: string;
  tone: string;
  description: string;
  cta: string;
  forbiddenWords: string;
  hashtags: string;
}
export interface Workspace {
  id: string;
  name: string;
  timezone: string;
  requireApproval: boolean;
  role: string;
}
export interface Snapshot {
  workspace: Workspace;
  posts: Post[];
  accounts: Account[];
  activity: Activity[];
  members: Member[];
  brand: Brand;
}
export const statusLabel = (s: string) => s.toLowerCase().replaceAll("_", " ");
export const dateLabel = (d: string, tz?: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(tz ? { timeZone: tz } : {}),
  }).format(new Date(d));
const now = new Date();
const upcoming = (n: number) =>
  new Date(now.getTime() + n * 86400000).toISOString();
export function demoSnapshot(): Snapshot {
  return {
    workspace: {
      id: "demo",
      name: "Acme Studio",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      requireApproval: true,
      role: "Owner",
    },
    brand: {
      name: "Acme Studio",
      website: "",
      tone: "Professional",
      description:
        "We help ambitious teams turn complex ideas into thoughtful digital products.",
      cta: "Let’s build something meaningful.",
      forbiddenWords: "revolutionary, guaranteed",
      hashtags: "#Design #Technology",
    },
    members: [
      {
        id: "you",
        name: "Alex Morgan",
        email: "alex@example.com",
        role: "Owner",
      },
      {
        id: "2",
        name: "Jamie Chen",
        email: "jamie@example.com",
        role: "Editor",
      },
      {
        id: "3",
        name: "Sam Rivera",
        email: "sam@example.com",
        role: "Approver",
      },
    ],
    accounts: [
      {
        id: "d-li",
        platform: "LinkedIn",
        name: "Acme Studio",
        state: "Demo connection",
      },
      {
        id: "d-ig",
        platform: "Instagram",
        name: "@acme.studio",
        state: "Demo connection",
      },
    ],
    posts: [
      {
        id: "sample-1",
        title: "Better systems. More room for ideas.",
        body: "The best workflows make space for the work that matters. This week, we’re sharing three ways to simplify your content process without losing your voice.\n\nWhat would you create with a little more room to think?",
        variants: {},
        platforms: ["LinkedIn"],
        status: "SCHEDULED",
        createdAt: now.toISOString(),
        scheduledAt: upcoming(1),
        creator: "Alex Morgan",
        version: 1,
      },
      {
        id: "sample-2",
        title: "Behind the build: our creative process",
        body: "A good idea starts with a better question. Here’s a look inside the way our team turns a blank page into something worth sharing.\n\nSave this for your next creative session. #Design #BehindTheScenes",
        variants: {},
        platforms: ["Instagram"],
        status: "NEEDS_REVIEW",
        createdAt: now.toISOString(),
        creator: "Jamie Chen",
        version: 1,
      },
      {
        id: "sample-3",
        title: "Your next big idea is already in your notes.",
        body: "Company knowledge deserves a life beyond the document. Turn what your team knows into content your audience can use.",
        variants: {},
        platforms: ["LinkedIn", "X"],
        status: "DRAFT",
        createdAt: now.toISOString(),
        creator: "Alex Morgan",
        version: 1,
      },
    ],
    activity: [
      {
        id: "a1",
        actor: "Jamie Chen",
        action: "submitted for review",
        entity: "Behind the build",
        at: now.toISOString(),
      },
      {
        id: "a2",
        actor: "Alex Morgan",
        action: "scheduled",
        entity: "Better systems. More room for ideas.",
        at: now.toISOString(),
      },
    ],
  };
}
