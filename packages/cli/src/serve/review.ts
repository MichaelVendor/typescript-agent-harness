import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export type ReviewBinding = {
  provider: "github";
  owner: string;
  repo: string;
  number: number;
  title?: string;
  url: string;
  boundAt: number;
};

export type ReviewSnapshot = ReviewBinding & {
  body?: string;
  state?: string;
  files: Array<{ path: string; status?: string }>;
  diffPreview?: string;
};

const DIFF_PREVIEW_MAX = 12_000;

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

function isReviewBinding(raw: unknown): raw is ReviewBinding {
  if (!raw || typeof raw !== "object") return false;
  const b = raw as Partial<ReviewBinding>;
  return (
    b.provider === "github" &&
    typeof b.owner === "string" &&
    typeof b.repo === "string" &&
    typeof b.number === "number" &&
    Number.isFinite(b.number) &&
    typeof b.url === "string" &&
    typeof b.boundAt === "number"
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
  opts: { mock?: ReviewSnapshot; token?: string },
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
  if (!opts.token) throw new Error("github token or mock snapshot required");
  return fetchGithubSnapshot(binding, opts.token);
}