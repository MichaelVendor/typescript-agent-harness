export const TrashIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v4.5M9.2 6.5v4.5" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);

/** Compact IM source marks for mirrored user bubbles (sized via CSS). */
export function ChannelIcon({ channel }: { channel: string }) {
  const c = channel.toLowerCase();
  if (c === "telegram") {
    return (
      <svg className="channel-icon" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="12" fill="#2AABEE" />
        <path
          fill="#fff"
          d="m5.5 11.7 12.6-4.9c.55-.21 1.05.13.87.9L16.9 17.8c-.14.66-.55.82-1.12.51l-3.12-2.3-1.5 1.45c-.16.15-.3.29-.62.29l.22-3.18 5.78-5.22c.25-.23-.05-.35-.4-.13l-7.15 4.5-3.1-.97c-.65-.2-.66-.65.31-.95Z"
        />
      </svg>
    );
  }
  if (c === "slack") {
    return (
      <svg className="channel-icon" viewBox="0 0 24 24" aria-hidden>
        <rect width="24" height="24" rx="5" fill="#4A154B" />
        <path fill="#E01E5A" d="M9.5 3.5a1.75 1.75 0 0 0-3.5 0V6H4a1.75 1.75 0 1 0 0 3.5h2v1.75a1.75 1.75 0 1 0 3.5 0V9.5H11a1.75 1.75 0 1 0 0-3.5H9.5V3.5Z" />
        <path fill="#36C5F0" d="M20.5 9.5a1.75 1.75 0 1 0 0-3.5H18V4a1.75 1.75 0 1 0-3.5 0v2H12.75a1.75 1.75 0 1 0 0 3.5H14.5V11a1.75 1.75 0 1 0 3.5 0V9.5h2.5Z" />
        <path fill="#2EB67D" d="M14.5 20.5a1.75 1.75 0 0 0 3.5 0V18H20a1.75 1.75 0 1 0 0-3.5h-2v-1.75a1.75 1.75 0 1 0-3.5 0V14.5H13a1.75 1.75 0 1 0 0 3.5h1.5v2.5Z" />
        <path fill="#ECB22E" d="M3.5 14.5a1.75 1.75 0 1 0 0 3.5H6V20a1.75 1.75 0 1 0 3.5 0v-2h1.75a1.75 1.75 0 1 0 0-3.5H9.5V13a1.75 1.75 0 1 0-3.5 0v1.5H3.5Z" />
      </svg>
    );
  }
  if (c === "feishu" || c === "lark") {
    return (
      <svg className="channel-icon" viewBox="0 0 24 24" aria-hidden>
        <rect width="24" height="24" rx="5" fill="#3370FF" />
        <path fill="#fff" d="M7 7.2h3.4L12 11l1.6-3.8H17L13.4 16.8h-2.8L7 7.2Z" />
      </svg>
    );
  }
  return (
    <span className="channel-icon fallback" title={channel} aria-label={channel}>
      {channel.slice(0, 1).toUpperCase()}
    </span>
  );
}
