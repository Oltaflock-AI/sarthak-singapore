"use client";

import { useLiveData } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { useEffect, useState } from "react";

interface Props {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export function PageHeader({ title, subtitle, right }: Props) {
  const { lastSync } = useLiveData();
  const [, setTick] = useState(0);

  // Re-render the "synced Xs ago" label every second
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <div className="page-sub">{subtitle}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {right}
        <span className="live-pill">
          <span className="live-dot" />
          Live · synced {timeAgo(lastSync)}
        </span>
      </div>
    </div>
  );
}
