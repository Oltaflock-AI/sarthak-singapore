interface Props {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, hint, action }: Props) {
  return (
    <div className="empty">
      {icon ?? <DefaultIcon />}
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

function DefaultIcon() {
  return (
    <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M9 12h6M12 9v6" />
    </svg>
  );
}
