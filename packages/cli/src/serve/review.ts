import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { githubReviewToken, gitlabReviewToken, resolveGitlabHost } from "../connectors.js";

export type ReviewBinding = {
  provider: "github" | "gitlab";
  owner: string;
  repo: string;
  number: number;
  title?: string;
  url: string;
  boundAt: number;
  host?: string;
};

export type ReviewSnapshot = ReviewBinding & {
  body?: string;
  state?: string;
  files: Array<{ path: string; status?: string }>;
  diffPreview?: string;
};

const DIFF_PREVIEW_MAX = 12_000;
const GITLAB_COM_ORIGINS = new Set(["https://gitlab.com", "http://gitlab.com"]);

export function reviewBindingPath(cwd: string): string {
  return path.join(path.resolve(cwd), ".tah", "review-binding.json");
}

export function parseGithubPrRef(input: string): { owner: string; repo: string; number: number } {
  const trimmed = input.trim();
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/#]+)\/pull\/(\d+)\/?$/i.exec(trimmed);
  if (url) {
    const owner = url[1]!;
    const repo = url[2]!.replace(/\.git$/i, "");
    const number = Number(url[3]);
    if (Number.isFinite(number) && number > 0) return { owner, repo, number };
  }
  const short = /^([^/#\s]+)\/([^/#\s]+)#(\d+)$/.exec(trimmed);
  if (short) {
    const number = Number(short[3]);
    if (Number.isFinite(number) && number > 0) {
      return { owner: short[1]!, repo: short[2]!, number };
    }
  }
  throw new Error(`invalid github pr ref: ${input}`);
}

export function parseGitlabMrRef(input: string): {
  owner: string;
  repo: string;
  number: number;
  host?: string;
} {
  const trimmed = input.trim();
  const url = /^(https?:\/\/[^/]+)\/(.+)\/-\/merge_requests\/(\d+)\/?$/i.exec(trimmed);
  if (url) {
    const origin = url[1]!.replace(/\/$/, "");
    const segments = url[2]!.replace(/\/$/, "").split("/").filter(Boolean);
    const number = Number(url[3]);
    if (segments.length >= 2 && Number.isFinite(number) && number > 0) {
      const repo = segments.pop()!;
      const owner = segments.join("/");
      const host = GITLAB_COM_ORIGINS.has(origin.toLowerCase()) ? undefined : origin;
      return { owner, repo, number, ...(host ? { host } : {}) };
    }
  }
  const short = /^(.+)!(\d+)$/.exec(trimmed);
  if (short) {
    const number = Number(short[2]);
    const slash = short[1]!.lastIndexOf("/");
    if (slash > 0 && Number.isFinite(number) && number > 0) {
      return {
        owner: short[1]!.slice(0, slash),
        repo: short[1]!.slice(slash + 1),
        number,
      };
    }
  }
  throw new Error(`invalid gitlab mr ref: ${input}`);
}

export type ParsedReviewRef =
  | ({ provider: "github" } & ReturnType<typeof parseGithubPrRef>)
  | ({ provider: "gitlab" } & ReturnType<typeof parseGitlabMrRef>);

export function parseReviewRef(input: string): ParsedReviewRef {
  try {
    return { provider: "github", ...parseGithubPrRef(input) };
  } catch {
    return { provider: "gitlab", ...parseGitlabMrRef(input) };
  }
}

export function reviewBindingUrl(parsed: ParsedReviewRef): string {
  if (parsed.provider === "github") {
    return `https://github.com/${parsed.owner}/${parsed.repo}/pull/${parsed.number}`;
  }
  const origin = parsed.host?.replace(/\/$/, "") ?? "https://gitlab.com";
  return `${origin}/${parsed.owner}/${parsed.repo}/-/merge_requests/${parsed.number}`;
}

function isReviewBinding(raw: unknown): raw is ReviewBinding {
  if (!raw || typeof raw !== "object") return false;
  const b = raw as Partial<ReviewBinding>;
  return (
    (b.provider === "github" || b.provider === "gitlab") &&
    typeof b.owner === "string" &&
    typeof b.repo === "string" &&
    typeof b.number === "number" &&
    Number.isFinite(b.number) &&
    typeof b.url === "string" &&
    typeof b.boundAt === "number" &&
    (b.host === undefined || typeof b.host === "string")
  );
}

export function bindReview(cwd: string, binding: ReviewBinding): void {
  const file = reviewBindingPath(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(binding, null, 2)}\n`);
}

export function loadReviewBinding(cwd: string): ReviewBinding | null {
  const file = reviewBindingPath(cwd);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return isReviewBinding(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function clearReviewBinding(cwd: string): void {
  const file = reviewBindingPath(cwd);
  if (existsSync(file)) unlinkSync(file);
}

function truncateDiff(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= DIFF_PREVIEW_MAX) return text;
  return `${text.slice(0, DIFF_PREVIEW_MAX)}\n…`;
}

function gitlabApiOrigin(binding: ReviewBinding): string {
  return binding.host?.replace(/\/$/, "") ?? resolveGitlabHost();
}

function gitlabChangeStatus(change: {
  new_file?: boolean;
  deleted_file?: boolean;
  renamed_file?: boolean;
}): string | undefined {
  if (change.new_file) return "added";
  if (change.deleted_file) return "removed";
  if (change.renamed_file) return "renamed";
  return "modified";
}

export async function fetchGitlabSnapshot(
  binding: ReviewBinding,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<ReviewSnapshot> {
  const origin = gitlabApiOrigin(binding);
  const project = encodeURIComponent(`${binding.owner}/${binding.repo}`);
  const headers = { "PRIVATE-TOKEN": token };
  const base = `${origin}/api/v4/projects/${project}/merge_requests/${binding.number}`;
  const [mrRes, changesRes] = await Promise.all([
    fetchFn(`${base}`, { headers }),
    fetchFn(`${base}/changes`, { headers }),
  ]);
  if (!mrRes.ok) throw new Error(`gitlab mr ${binding.number}: HTTP ${mrRes.status}`);
  const mr = (await mrRes.json()) as {
    title?: string;
    description?: string | null;
    state?: string;
    web_url?: string;
  };
  let files: ReviewSnapshot["files"] = [];
  let diffPreview: string | undefined;
  if (changesRes.ok) {
    const body = (await changesRes.json()) as {
      changes?: Array<{
        old_path?: string;
        new_path?: string;
        diff?: string;
        new_file?: boolean;
        deleted_file?: boolean;
        renamed_file?: boolean;
      }>;
    };
    const changes = body.changes ?? [];
    files = changes.map((c) => {
      const filePath = c.new_path || c.old_path || "";
      const status = gitlabChangeStatus(c);
      return { path: filePath, ...(status ? { status } : {}) };
    });
    const joined = changes.map((c) => c.diff ?? "").join("\n");
    diffPreview = truncateDiff(joined || undefined);
  }
  const title = mr.title ?? binding.title;
  return {
    ...binding,
    url: mr.web_url ?? binding.url,
    ...(title ? { title } : {}),
    ...(mr.description ? { body: mr.description } : {}),
    ...(mr.state ? { state: mr.state } : {}),
    files,
    ...(diffPreview !== undefined ? { diffPreview } : {}),
  };
}

async function fetchGithubSnapshot(binding: ReviewBinding, token: string): Promise<ReviewSnapshot> {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const base = `https://api.github.com/repos/${binding.owner}/${binding.repo}`;
  const [prRes, filesRes] = await Promise.all([
    fetch(`${base}/pulls/${binding.number}`, { headers }),
    fetch(`${base}/pulls/${binding.number}/files?per_page=100`, { headers }),
  ]);
  if (!prRes.ok) throw new Error(`github pr ${binding.number}: HTTP ${prRes.status}`);
  const pr = (await prRes.json()) as {
    title?: string;
    body?: string | null;
    state?: string;
    html_url?: string;
  };
  const files: ReviewSnapshot["files"] = filesRes.ok
    ? ((await filesRes.json()) as Array<{ filename?: string; status?: string }>).map((f) => ({
        path: f.filename ?? "",
        ...(f.status ? { status: f.status } : {}),
      }))
    : [];
  const title = pr.title ?? binding.title;
  return {
    ...binding,
    url: pr.html_url ?? binding.url,
    ...(title ? { title } : {}),
    ...(pr.body ? { body: pr.body } : {}),
    ...(pr.state ? { state: pr.state } : {}),
    files,
  };
}

export async function fetchReviewSnapshot(
  binding: ReviewBinding,
  opts: { mock?: ReviewSnapshot; token?: string; home?: string; fetch?: typeof fetch },
): Promise<ReviewSnapshot> {
  if (opts.mock) {
    const diffPreview = truncateDiff(opts.mock.diffPreview);
    return {
      ...binding,
      ...opts.mock,
      files: opts.mock.files ?? [],
      ...(diffPreview !== undefined ? { diffPreview } : {}),
    };
  }
  const home = opts.home ?? "";
  const token =
    opts.token ??
    (binding.provider === "gitlab" ? gitlabReviewToken(home) : githubReviewToken(home));
  if (!token) {
    throw new Error("connect GitHub (oauth or PAT) or GitLab PAT, or pass a mock snapshot");
  }
  if (binding.provider === "gitlab") {
    return fetchGitlabSnapshot(binding, token, opts.fetch);
  }
  return fetchGithubSnapshot(binding, token);
}