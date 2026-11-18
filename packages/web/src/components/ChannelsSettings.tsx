import type { ChannelsSettingsView, SettingsView } from "@typescript-agent-harness/cli";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { settingsMessages as t } from "../i18n/settings.en";

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function sourceLabel(source: "settings" | "env" | null): string {
  if (source === "env") return t.channels.fromEnv;
  if (source === "settings") return t.channels.fromSettings;
  return t.channels.notSet;
}

/** Telegram / Slack / Feishu — toggles in tah.channels.json, secrets in ~/.tah/settings.json. */
export function ChannelsSettings(props: {
  busy: boolean;
  view: SettingsView;
  onChange(view: SettingsView): void;
}) {
  const channels = props.view.channels;
  const c = t.channels;
  const [tgEnabled, setTgEnabled] = useState(channels.telegram.enabled);
  const [tgToken, setTgToken] = useState("");
  const [mirrorChatId, setMirrorChatId] = useState(channels.telegram.mirrorChatId);
  const [slackEnabled, setSlackEnabled] = useState(channels.slack.enabled);
  const [slackBot, setSlackBot] = useState("");
  const [slackSecret, setSlackSecret] = useState("");
  const [feishuEnabled, setFeishuEnabled] = useState(channels.feishu.enabled);
  const [feishuAppId, setFeishuAppId] = useState("");
  const [feishuSecret, setFeishuSecret] = useState("");
  const [feishuVerify, setFeishuVerify] = useState("");
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [pending, setPending] = useState(false);
  const locked = props.busy || pending;

  useEffect(() => {
    setTgEnabled(channels.telegram.enabled);
    setMirrorChatId(channels.telegram.mirrorChatId);
    setSlackEnabled(channels.slack.enabled);
    setFeishuEnabled(channels.feishu.enabled);
  }, [channels]);

  const save = async () => {
    setPending(true);
    setError(undefined);
    setNote(undefined);
    try {
      const next = await api.channels({
        telegram: {
          enabled: tgEnabled,
          ...(tgToken.trim() ? { botToken: tgToken.trim() } : {}),
          mirrorChatId: mirrorChatId.trim() === "" ? null : mirrorChatId.trim(),
        },
        slack: {
          enabled: slackEnabled,
          ...(slackBot.trim() ? { botToken: slackBot.trim() } : {}),
          ...(slackSecret.trim() ? { signingSecret: slackSecret.trim() } : {}),
        },
        feishu: {
          enabled: feishuEnabled,
          ...(feishuAppId.trim() ? { appId: feishuAppId.trim() } : {}),
          ...(feishuSecret.trim() ? { appSecret: feishuSecret.trim() } : {}),
          ...(feishuVerify.trim() ? { verificationToken: feishuVerify.trim() } : {}),
        },
      });
      props.onChange(next);
      setTgToken("");
      setSlackBot("");
      setSlackSecret("");
      setFeishuAppId("");
      setFeishuSecret("");
      setFeishuVerify("");
      setNote(c.savedNote);
    } catch (err) {
      setError(errText(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <p className="settings-desc">
        {c.introBeforeSecrets}
        <code>~/.tah/settings.json</code>
        {c.introBetween}
        <code>tah.channels.json</code>
        {c.introAfter}
      </p>

      <ChannelCard
        title={c.telegram.title}
        hint={
          <>
            {c.telegram.hintBefore}{" "}
            <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">
              @BotFather
            </a>
            {c.telegram.hintAfter}
          </>
        }
        enabled={tgEnabled}
        onEnabled={setTgEnabled}
        locked={locked}
        status={
          channels.telegram.tokenHint
            ? `${channels.telegram.tokenHint} · ${sourceLabel(channels.telegram.tokenSource)}`
            : sourceLabel(null)
        }
      >
        <label>
          <span>{c.telegram.botToken}</span>
          <input
            type="password"
            autoComplete="off"
            value={tgToken}
            placeholder={channels.telegram.tokenHint ? c.leaveBlank : "123456:ABC…"}
            disabled={locked}
            onChange={(e) => setTgToken(e.target.value)}
          />
        </label>
        <label>
          <span>{c.telegram.mirrorChatId}</span>
          <input
            value={mirrorChatId}
            placeholder={c.telegram.mirrorPlaceholder}
            disabled={locked}
            onChange={(e) => setMirrorChatId(e.target.value)}
          />
          <small>{c.telegram.mirrorHelp}</small>
        </label>
      </ChannelCard>

      <ChannelCard
        title={c.slack.title}
        hint={c.slack.hint}
        enabled={slackEnabled}
        onEnabled={setSlackEnabled}
        locked={locked}
        status={
          channels.slack.botTokenHint
            ? `${channels.slack.botTokenHint} · ${sourceLabel(channels.slack.botTokenSource)}`
            : sourceLabel(null)
        }
      >
        <label>
          <span>{c.slack.botToken}</span>
          <input
            type="password"
            autoComplete="off"
            value={slackBot}
            placeholder={channels.slack.botTokenHint ? c.leaveBlank : "xoxb-…"}
            disabled={locked}
            onChange={(e) => setSlackBot(e.target.value)}
          />
        </label>
        <label>
          <span>{c.slack.signingSecret}</span>
          <input
            type="password"
            autoComplete="off"
            value={slackSecret}
            placeholder={channels.slack.signingSecretHint ? c.leaveBlank : "…"}
            disabled={locked}
            onChange={(e) => setSlackSecret(e.target.value)}
          />
        </label>
      </ChannelCard>

      <ChannelCard
        title={c.feishu.title}
        hint={c.feishu.hint}
        enabled={feishuEnabled}
        onEnabled={setFeishuEnabled}
        locked={locked}
        status={
          channels.feishu.appIdHint
            ? `${channels.feishu.appIdHint} · ${sourceLabel(channels.feishu.appIdSource)}`
            : sourceLabel(null)
        }
      >
        <label>
          <span>{c.feishu.appId}</span>
          <input
            type="password"
            autoComplete="off"
            value={feishuAppId}
            placeholder={channels.feishu.appIdHint ? c.leaveBlank : "cli_…"}
            disabled={locked}
            onChange={(e) => setFeishuAppId(e.target.value)}
          />
        </label>
        <label>
          <span>{c.feishu.appSecret}</span>
          <input
            type="password"
            autoComplete="off"
            value={feishuSecret}
            placeholder={channels.feishu.appSecretHint ? c.leaveBlank : "…"}
            disabled={locked}
            onChange={(e) => setFeishuSecret(e.target.value)}
          />
        </label>
        <label>
          <span>{c.feishu.verificationToken}</span>
          <input
            type="password"
            autoComplete="off"
            value={feishuVerify}
            placeholder={channels.feishu.verificationTokenHint ? c.leaveBlank : "…"}
            disabled={locked}
            onChange={(e) => setFeishuVerify(e.target.value)}
          />
        </label>
      </ChannelCard>

      <div className="card-actions">
        <span className="spacer" />
        <button type="button" className="primary" disabled={locked} onClick={() => void save()}>
          {c.save}
        </button>
      </div>

      {note ? <div className="settings-note">{note}</div> : null}
      {error ? <div className="modal-error">{error}</div> : null}
      {props.busy ? <div className="settings-note">{c.busyNote}</div> : null}
    </>
  );
}

function ChannelCard(props: {
  title: string;
  hint: ReactNode;
  enabled: boolean;
  onEnabled(v: boolean): void;
  locked: boolean;
  status: string;
  children: ReactNode;
}) {
  return (
    <div className="model-card" style={{ display: "block", marginBottom: 12 }}>
      <div className="model-main" style={{ marginBottom: 8 }}>
        <div className="model-name" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
            <input
              type="checkbox"
              checked={props.enabled}
              disabled={props.locked}
              onChange={(e) => props.onEnabled(e.target.checked)}
            />
            {props.title}
          </label>
          {props.enabled ? <span className="badge">{t.channels.on}</span> : null}
        </div>
        <div className="model-meta">{props.status}</div>
        <p className="settings-desc" style={{ marginTop: 6, marginBottom: 0 }}>
          {props.hint}
        </p>
      </div>
      {props.enabled ? <div className="model-form">{props.children}</div> : null}
    </div>
  );
}

export type { ChannelsSettingsView };
