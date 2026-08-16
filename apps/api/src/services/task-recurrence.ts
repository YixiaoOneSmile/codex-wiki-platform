import { z } from "zod";
import { AppError } from "../lib/errors.js";

export const recurrenceTypeSchema = z.enum(["once", "daily", "weekly", "monthly", "interval"]);
export type RecurrenceType = z.infer<typeof recurrenceTypeSchema>;
export type RecurrenceConfig = { intervalMinutes?: number; weekdays?: number[]; dayOfMonth?: number };

export function validateRecurrence(type: RecurrenceType, value: unknown): RecurrenceConfig {
  const config = z.object({ intervalMinutes: z.number().int().min(1).max(525_600).optional(), weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(), dayOfMonth: z.number().int().min(1).max(31).optional() }).parse(value ?? {});
  if (type === "interval" && !config.intervalMinutes) throw new AppError(400, "INVALID_RECURRENCE", "自定义间隔必须至少为1分钟");
  if (type === "interval") return { intervalMinutes: config.intervalMinutes as number };
  if (type === "weekly" && config.weekdays) return { weekdays: [...new Set(config.weekdays)].sort() };
  if (type === "monthly" && config.dayOfMonth) return { dayOfMonth: config.dayOfMonth };
  return {};
}

export function nextOccurrence(type: RecurrenceType, config: RecurrenceConfig, previous: Date, now = new Date()): Date | null {
  if (type === "once") return null;
  let candidate = new Date(previous);
  const advance = () => {
    if (type === "interval") candidate = new Date(candidate.getTime() + (config.intervalMinutes ?? 1) * 60_000);
    else if (type === "daily") candidate = new Date(candidate.getTime() + 24 * 60 * 60_000);
    else if (type === "weekly") candidate = new Date(candidate.getTime() + 7 * 24 * 60 * 60_000);
    else {
      const day = config.dayOfMonth ?? candidate.getUTCDate();
      candidate.setUTCDate(1);
      candidate.setUTCMonth(candidate.getUTCMonth() + 1);
      const lastDay = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0)).getUTCDate();
      candidate.setUTCDate(Math.min(day, lastDay));
    }
  };
  do { advance(); } while (candidate.getTime() <= now.getTime());
  return candidate;
}

export function recurrenceFromNaturalLanguage(content: string): { type: RecurrenceType; config: RecurrenceConfig } {
  const interval = content.match(/每隔\s*(\d{1,4})\s*(分钟?|小时|天)/);
  if (interval?.[1] && interval[2]) {
    const factor = interval[2].startsWith("小时") ? 60 : interval[2] === "天" ? 1_440 : 1;
    return { type: "interval", config: { intervalMinutes: Number(interval[1]) * factor } };
  }
  if (/(每天|每日)/.test(content)) return { type: "daily", config: {} };
  if (/(每周|每星期)/.test(content)) {
    const weekdayText = content.match(/(?:每周|每星期)([一二三四五六日天])/ )?.[1];
    const weekdayMap: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
    return { type: "weekly", config: weekdayText ? { weekdays: [weekdayMap[weekdayText] as number] } : {} };
  }
  if (/每月/.test(content)) {
    const day = Number(content.match(/每月\s*(\d{1,2})\s*[号日]/)?.[1]);
    return { type: "monthly", config: day >= 1 && day <= 31 ? { dayOfMonth: day } : {} };
  }
  return { type: "once", config: {} };
}

export function recurrenceLabel(type: RecurrenceType, config: RecurrenceConfig): string {
  if (type === "daily") return "每天";
  if (type === "weekly") return "每周";
  if (type === "monthly") return "每月";
  if (type === "interval") return `每隔 ${config.intervalMinutes ?? 1} 分钟`;
  return "仅一次";
}
