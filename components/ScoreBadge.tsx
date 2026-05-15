import { scoreLabel } from "@/lib/format";

interface Props {
  score: number | null | undefined;
  showScore?: boolean;
}

export function ScoreBadge({ score, showScore = true }: Props) {
  if (score == null) return null;
  const label = scoreLabel(score);
  return (
    <span className={`score ${label.toLowerCase()}`}>
      {label}
      {showScore && <span className="num"> · {score}</span>}
    </span>
  );
}
