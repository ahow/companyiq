import { useMemo } from "react";
import { BarChart3 } from "lucide-react";

interface ScoreDistributionProps {
  companies: any[];
  listName?: string;
}

const BUCKETS = [
  { label: "0%", min: 0, max: 0 },
  { label: "1-10%", min: 1, max: 10 },
  { label: "10-20%", min: 11, max: 20 },
  { label: "20-30%", min: 21, max: 30 },
  { label: "30-40%", min: 31, max: 40 },
  { label: "40-50%", min: 41, max: 50 },
  { label: "50-60%", min: 51, max: 60 },
  { label: "60-70%", min: 61, max: 70 },
  { label: "70-80%", min: 71, max: 80 },
  { label: "80-90%", min: 81, max: 90 },
  { label: "90-100%", min: 91, max: 100 },
];

export default function ScoreDistribution({ companies, listName }: ScoreDistributionProps) {
  const { bucketCounts, scoredCount, totalCount, maxCount } = useMemo(() => {
    const counts = new Array(BUCKETS.length).fill(0);
    let scored = 0;

    for (const c of companies) {
      if (c.totalScore === null || c.totalScore === undefined) continue;
      scored++;
      const score = Math.round(c.totalScore);
      for (let i = 0; i < BUCKETS.length; i++) {
        if (score >= BUCKETS[i].min && score <= BUCKETS[i].max) {
          counts[i]++;
          break;
        }
      }
    }

    return {
      bucketCounts: counts,
      scoredCount: scored,
      totalCount: companies.length,
      maxCount: Math.max(...counts, 1),
    };
  }, [companies]);

  return (
    <div className="bg-white rounded-lg border p-5">
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Score Distribution</p>
          <h3 className="text-base font-semibold text-gray-900 mt-0.5">
            How risk scores are spread across the portfolio
          </h3>
          <p className="text-sm text-gray-400 mt-0.5">
            {scoredCount} of {totalCount} companies scored
            {listName ? ` \u00b7 list: ${listName}` : ""}
          </p>
        </div>
        <BarChart3 className="w-5 h-5 text-gray-300 mt-1 flex-shrink-0" />
      </div>

      {/* Histogram */}
      <div className="mt-5 flex items-end gap-1.5 sm:gap-2" style={{ height: "180px" }}>
        {BUCKETS.map((bucket, i) => {
          const count = bucketCounts[i];
          const heightPct = maxCount > 0 ? (count / maxCount) * 100 : 0;
          // First bucket (0%) gets a gray tone, others get blue gradient
          const isZeroBucket = i === 0;
          const barColor = isZeroBucket
            ? "bg-gray-300"
            : count > 0
            ? "bg-blue-500"
            : "bg-gray-100";

          return (
            <div key={bucket.label} className="flex-1 flex flex-col items-center justify-end h-full">
              {/* Count label */}
              <span
                className={`text-xs font-semibold mb-1 ${
                  count > 0 ? "text-gray-700" : "text-gray-300"
                }`}
              >
                {count}
              </span>
              {/* Bar */}
              <div
                className={`w-full rounded-t ${barColor} transition-all duration-300`}
                style={{
                  height: count > 0 ? `${Math.max(heightPct, 4)}%` : "3px",
                  minHeight: count > 0 ? "8px" : "3px",
                }}
              />
              {/* Bucket label */}
              <span className="text-[10px] text-gray-400 mt-1.5 whitespace-nowrap leading-tight text-center">
                {bucket.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
