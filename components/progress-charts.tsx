'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface WeekPoint {
  weekStart: string;
  sessionsCompleted: number;
  sessionsPlanned: number;
  setsLogged: number;
  volumeKg: number;
  activityMinutes: number;
}

interface TrendPoint {
  date: string;
  bestWeightKg: number | null;
  bestReps: number | null;
  bestHoldSeconds: number | null;
  totalVolumeKg: number;
}

const AXIS = { fontSize: 11, fill: 'var(--text-muted)' };

export function ProgressCharts({
  weeks,
  muscleBalance,
  trend,
}: {
  weeks: WeekPoint[];
  muscleBalance: { muscle: string; label: string; sets: number }[];
  trend: { name: string; points: TrendPoint[] } | null;
}) {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-medium mb-3">Sessions completed by week</p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeks} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="weekStart"
                tick={AXIS}
                tickFormatter={(v: string) => v.slice(5)}
                stroke="var(--border)"
              />
              <YAxis tick={AXIS} allowDecimals={false} stroke="var(--border)" />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  fontSize: 12,
                  color: 'var(--text)',
                }}
                labelFormatter={(v) => `Week of ${v}`}
              />
              <Bar dataKey="sessionsPlanned" name="Scheduled" fill="var(--border-strong)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="sessionsCompleted" name="Completed" fill="var(--accent)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-3">Sets logged and other activity</p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weeks} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="weekStart"
                tick={AXIS}
                tickFormatter={(v: string) => v.slice(5)}
                stroke="var(--border)"
              />
              <YAxis tick={AXIS} allowDecimals={false} stroke="var(--border)" />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  fontSize: 12,
                  color: 'var(--text)',
                }}
                labelFormatter={(v) => `Week of ${v}`}
              />
              <Line
                type="monotone"
                dataKey="setsLogged"
                name="Sets"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="activityMinutes"
                name="Activity minutes"
                stroke="var(--accent-2)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {trend && trend.points.length > 0 ? (
        <div>
          <p className="text-sm font-medium mb-3">{trend.name}</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend.points} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={AXIS}
                  tickFormatter={(v: string) => v.slice(5)}
                  stroke="var(--border)"
                />
                <YAxis tick={AXIS} stroke="var(--border)" />
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface-raised)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    fontSize: 12,
                    color: 'var(--text)',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="bestWeightKg"
                  name="Best weight (kg)"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="bestReps"
                  name="Best reps"
                  stroke="var(--accent-2)"
                  strokeWidth={2}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      {muscleBalance.length > 0 ? (
        <div>
          <p className="text-sm font-medium mb-3">Where your sets went</p>
          <div className="space-y-1.5">
            {muscleBalance.map((m) => {
              const max = muscleBalance[0]?.sets ?? 1;
              return (
                <div key={m.muscle} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 truncate text-[var(--text-muted)]">{m.label}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-[var(--surface-sunken)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]"
                      style={{ width: `${(m.sets / max) * 100}%` }}
                    />
                  </div>
                  <span className="w-10 text-right tabular-nums text-[var(--text-muted)]">
                    {m.sets}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
