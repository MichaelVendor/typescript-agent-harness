/**
 * Read project `tah.channels.json` (same shape as CLI channel-host).
 * `anyEnabled` means serve will auto-enable Super-agent IM (do not also spawn channel-host).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type DesktopChannelsConfig = {
  /** Absolute persistDir for Super-agent panel + channel-host. */
  persistDir: string;
  /** True when telegram / slack / feishu has enabled: true. */
  anyEnabled: boolean;
  enabled: { telegram: boolean; slack: boolean; feishu: boolean };
};

type FileShape = {
  persistDir?: string;
  channels?: {
    telegram?: { enabled?: boolean };
    slack?: { enabled?: boolean };
    feishu?: { enabled?: boolean };
  };
};

export function readChannelsConfig(cwd: string): DesktopChannelsConfig {
  const file = path.join(cwd, "tah.channels.json");
  let raw: FileShape = {};
  if (existsSync(file)) {
    try {
      raw = JSON.parse(readFileSync(file, "utf8")) as FileShape;
    } catch {
      raw = {};
    }
  }
  const telegram = raw.channels?.telegram?.enabled === true;
  const slack = raw.channels?.slack?.enabled === true;
  const feishu = raw.channels?.feishu?.enabled === true;
  return {
    persistDir: path.resolve(cwd, raw.persistDir ?? ".tah/super-agent"),
    anyEnabled: telegram || slack || feishu,
    enabled: { telegram, slack, feishu },
  };
}
