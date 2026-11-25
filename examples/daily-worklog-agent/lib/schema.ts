export type WorklogConfig = {
  repos: string[];
  cursor: { projectsRoot: string };
  browser: {
    historyDb: string;
    domainAllowlist: string[];
  };
  timezone: string;
};

export type DayBundle = {
  date: string;
  git: Array<{
    repo: string;
    commits: Array<{ hash: string; subject: string; files?: string[] }>;
  }>;
  cursor: Array<{ workspace: string; note: string; evidence: string }>;
  browser: Array<{ url: string; title: string; visitTime?: string }>;
  gaps: string[];
};

export type DayCard = {
  date: string;
  summary: string;
  markdown: string;
  bundle: DayBundle;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateDayBundle(bundle: DayBundle): string[] {
  const problems: string[] = [];
  if (!DATE_RE.test(bundle.date)) {
    problems.push(`invalid date "${bundle.date}"; expected YYYY-MM-DD`);
  }
  for (let i = 0; i < bundle.browser.length; i++) {
    const row = bundle.browser[i]!;
    if (!row.url || String(row.url).trim() === "") {
      problems.push(`browser[${i}]: url must be non-empty when present`);
    }
  }
  return problems;
}