import { HOUR_HEIGHT } from "@/lib/dateUtils";

interface TimeRulerProps {
  startHour?: number;
  endHour?: number;
}

export function TimeRuler({ startHour = 0, endHour = 24 }: TimeRulerProps) {
  const hours = Array.from(
    { length: endHour - startHour + 1 },
    (_, i) => startHour + i
  );

  return (
    <div className="relative select-none" style={{ height: (endHour - startHour) * HOUR_HEIGHT }}>
      {hours.map((hour) => (
        <div
          key={hour}
          className="absolute left-0 right-0 flex items-start"
          style={{ top: (hour - startHour) * HOUR_HEIGHT }}
        >
          <span className="w-12 text-right pr-3 text-xs text-gray-400 leading-none -mt-2">
            {hour < 24 ? `${String(hour).padStart(2, "0")}:00` : ""}
          </span>
          <div className="flex-1 border-t border-gray-100 mt-0" />
        </div>
      ))}
      {/* Half-hour marks */}
      {hours.slice(0, -1).map((hour) => (
        <div
          key={`${hour}-30`}
          className="absolute left-0 right-0 flex items-start"
          style={{ top: (hour - startHour) * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
        >
          <span className="w-12" />
          <div className="flex-1 border-t border-dashed border-gray-100" />
        </div>
      ))}
    </div>
  );
}
