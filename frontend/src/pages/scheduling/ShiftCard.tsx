import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Users,
  Truck,
} from "lucide-react";
import type { ShiftRecord } from "../../modules/scheduling";
import { normalizePositions } from "../../modules/scheduling/services/api";
import { formatTime } from "../../utils/dateFormatting";
import { colorCardStyle } from "../../utils/colorContrast";

/** Returns the minimum staffing target for a shift, or null if none is configured. */
const getStaffingTarget = (shift: ShiftRecord): number | null => {
  const positions = normalizePositions(
    (shift.apparatus_positions ?? shift.positions) as unknown[] | null,
  );
  const requiredCount = positions.filter(p => p.required).length;
  if (requiredCount > 0) return requiredCount;
  if (shift.min_staffing != null && shift.min_staffing > 0) return shift.min_staffing;
  return null;
};

const isUnderstaffed = (shift: ShiftRecord): boolean => {
  const target = getStaffingTarget(shift);
  return target != null && shift.attendee_count < target;
};

const isFullyStaffed = (shift: ShiftRecord): boolean => {
  const target = getStaffingTarget(shift);
  return target != null && shift.attendee_count >= target;
};

const getShiftTemplateColor = (shift: ShiftRecord): string | undefined => {
  if (shift.color) return undefined;
  const timePart = shift.start_time.includes("T")
    ? shift.start_time.split("T")[1] ?? ""
    : shift.start_time;
  const startHour = parseInt(timePart.split(":")[0] ?? "0", 10);
  if (startHour >= 5 && startHour < 10)
    return "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30";
  if (startHour >= 10 && startHour < 17)
    return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30";
  return "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/30";
};

/**
 * Resolve shift card appearance based on staffing status.
 *
 * Fully staffed -> green tint + green border (overrides template color).
 * Understaffed -> amber tint + amber border (overrides template color).
 * No staffing target configured -> falls back to template color.
 */
const getShiftCardAppearance = (
  shift: ShiftRecord,
  resolvedTheme: "light" | "dark" | "high-contrast",
): { className: string; style: React.CSSProperties | undefined } => {
  if (isFullyStaffed(shift)) {
    return {
      className: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30",
      style: undefined,
    };
  }
  if (isUnderstaffed(shift)) {
    return {
      className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
      style: undefined,
    };
  }
  return {
    className: getShiftTemplateColor(shift) ?? "",
    style: shift.color ? colorCardStyle(shift.color, resolvedTheme) : undefined,
  };
};

type ShiftCardVariant = "desktop-week" | "mobile" | "compact";

interface ShiftCardProps {
  shift: ShiftRecord;
  variant?: ShiftCardVariant;
  selected?: boolean;
  resolvedTheme: "light" | "dark" | "high-contrast";
  timezone: string;
  onClick?: (shift: ShiftRecord) => void;
  /** Mobile month cards use active:ring instead of hover:ring for touch UX */
  touchOnly?: boolean;
}

const VARIANT_STYLES: Record<ShiftCardVariant, {
  button: string;
  iconSize: string;
  gap: string;
  showNotes: boolean;
  showEndTime: boolean;
  showStaffSuffix: boolean;
}> = {
  "desktop-week": {
    button: "mb-2 p-2 rounded-lg border text-xs",
    iconSize: "w-3 h-3",
    gap: "gap-2",
    showNotes: true,
    showEndTime: true,
    showStaffSuffix: false,
  },
  mobile: {
    button: "p-3 rounded-lg border text-sm",
    iconSize: "w-3.5 h-3.5",
    gap: "gap-3",
    showNotes: true,
    showEndTime: true,
    showStaffSuffix: true,
  },
  compact: {
    button: "mb-1 px-1.5 py-1 rounded-sm border text-xs",
    iconSize: "w-3 h-3",
    gap: "",
    showNotes: false,
    showEndTime: false,
    showStaffSuffix: false,
  },
};

const ShiftCard: React.FC<ShiftCardProps> = ({
  shift,
  variant = "desktop-week",
  selected = false,
  resolvedTheme,
  timezone,
  onClick,
  touchOnly = false,
}) => {
  const card = getShiftCardAppearance(shift, resolvedTheme);
  const v = VARIANT_STYLES[variant];
  const hoverRing = touchOnly
    ? "active:ring-2 active:ring-violet-500/50"
    : "hover:ring-2 hover:ring-violet-500/50";
  const selectedRing = selected ? "ring-2 ring-violet-500" : "";

  if (variant === "compact") {
    return (
      <button
        onClick={() => onClick?.(shift)}
        className={`${v.button} w-full text-left cursor-pointer ${hoverRing} transition-all ${selectedRing} ${card.className}`}
        style={card.style}
      >
        <p className="font-medium truncate">
          {isUnderstaffed(shift) ? (
            <AlertTriangle className="w-3 h-3 inline text-amber-600 dark:text-amber-400 mr-0.5" />
          ) : isFullyStaffed(shift) ? (
            <CheckCircle2 className="w-3 h-3 inline text-green-600 dark:text-green-400 mr-0.5" />
          ) : null}
          {formatTime(shift.start_time, timezone)}
          {shift.apparatus_unit_number && (
            <span className="ml-1 opacity-70">
              {shift.apparatus_unit_number}
            </span>
          )}
          <span className="ml-1 opacity-70">
            ({shift.attendee_count}
            {getStaffingTarget(shift) != null && `/${getStaffingTarget(shift)}`})
          </span>
        </p>
      </button>
    );
  }

  const iconGap = variant === "mobile" ? "gap-1" : "gap-0.5";

  return (
    <button
      onClick={() => onClick?.(shift)}
      className={`${v.button} w-full text-left cursor-pointer ${hoverRing} transition-all ${selectedRing} ${card.className}`}
      style={card.style}
    >
      <p className={`font-medium ${variant === "desktop-week" ? "truncate" : ""}`}>
        {formatTime(shift.start_time, timezone)}
        {v.showEndTime && shift.end_time
          ? ` - ${formatTime(shift.end_time, timezone)}`
          : ""}
      </p>
      {v.showNotes && shift.notes && (
        <p className="mt-1 opacity-80 line-clamp-2">
          {shift.notes}
        </p>
      )}
      <div className={`flex items-center ${v.gap} ${variant === "desktop-week" ? "mt-1" : "mt-1.5"}`}>
        {isUnderstaffed(shift) ? (
          <span
            className={`text-amber-600 dark:text-amber-400 flex items-center ${iconGap} ${variant === "mobile" ? "text-xs" : ""}`}
            title={`Understaffed: ${shift.attendee_count}/${getStaffingTarget(shift)} filled`}
          >
            <AlertTriangle className={v.iconSize} />
          </span>
        ) : isFullyStaffed(shift) ? (
          <span
            className={`text-green-600 dark:text-green-400 flex items-center ${iconGap} ${variant === "mobile" ? "text-xs" : ""}`}
            title="Fully staffed"
          >
            <CheckCircle2 className={v.iconSize} />
          </span>
        ) : null}
        <span className={`opacity-70 flex items-center ${iconGap} ${variant === "mobile" ? "text-xs" : ""}`}>
          <Users className={v.iconSize} />{" "}
          {shift.attendee_count}
          {getStaffingTarget(shift) != null && `/${getStaffingTarget(shift)}`}{v.showStaffSuffix ? " staff" : ""}
        </span>
        {shift.apparatus_unit_number && (
          <span className={`opacity-70 flex items-center ${iconGap} ${variant === "mobile" ? "text-xs" : ""}`}>
            <Truck className={v.iconSize} />{" "}
            {shift.apparatus_unit_number}
          </span>
        )}
      </div>
    </button>
  );
};

export default ShiftCard;
