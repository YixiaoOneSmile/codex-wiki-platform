import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { resolveScheduledFor } from "../src/services/task-natural-language.js";
import { nextOccurrence, recurrenceFromNaturalLanguage } from "../src/services/task-recurrence.js";

describe("natural-language scheduled time", () => {
  const now = new Date("2026-08-04T07:00:00.000Z");

  it("calculates Chinese relative minutes without relying on the model date", () => {
    const result = resolveScheduledFor("2分钟后抓取网页", "not-an-iso-date", now);
    expect(result.toISOString()).toBe("2026-08-04T07:02:00.000Z");
  });

  it("calculates Chinese relative hours", () => {
    const result = resolveScheduledFor("3小时之后抓取网页", undefined, now);
    expect(result.toISOString()).toBe("2026-08-04T10:00:00.000Z");
  });

  it("accepts a model timestamp with a space and explicit offset", () => {
    const result = resolveScheduledFor("明天下午三点抓取网页", "2026-08-05 15:00:00+08:00", now);
    expect(result.toISOString()).toBe("2026-08-05T07:00:00.000Z");
  });

  it("returns a user-facing error for an invalid model timestamp", () => {
    expect(() => resolveScheduledFor("明天抓取网页", "tomorrow", now)).toThrowError(AppError);
    expect(() => resolveScheduledFor("明天抓取网页", "tomorrow", now)).toThrow("没有识别到有效执行时间");
  });
});

describe("recurring scheduled tasks", () => {
  it("recognizes common Chinese recurrence phrases", () => {
    expect(recurrenceFromNaturalLanguage("每天上午9点抓取网页").type).toBe("daily");
    expect(recurrenceFromNaturalLanguage("每周一抓取网页")).toEqual({ type: "weekly", config: { weekdays: [1] } });
    expect(recurrenceFromNaturalLanguage("每月1号抓取网页")).toEqual({ type: "monthly", config: { dayOfMonth: 1 } });
    expect(recurrenceFromNaturalLanguage("每隔6小时抓取网页")).toEqual({ type: "interval", config: { intervalMinutes: 360 } });
  });

  it("uses an interval as the first execution delay", () => {
    const now = new Date("2026-08-04T07:00:00.000Z");
    expect(resolveScheduledFor("每隔6小时抓取网页", undefined, now).toISOString()).toBe("2026-08-04T13:00:00.000Z");
  });

  it("calculates daily, weekly, monthly and interval occurrences", () => {
    const previous = new Date("2026-01-31T01:00:00.000Z");
    expect(nextOccurrence("daily", {}, previous, previous)?.toISOString()).toBe("2026-02-01T01:00:00.000Z");
    expect(nextOccurrence("weekly", {}, previous, previous)?.toISOString()).toBe("2026-02-07T01:00:00.000Z");
    expect(nextOccurrence("monthly", {}, previous, previous)?.toISOString()).toBe("2026-02-28T01:00:00.000Z");
    expect(nextOccurrence("monthly", { dayOfMonth: 31 }, new Date("2026-02-28T01:00:00.000Z"), new Date("2026-02-28T01:00:00.000Z"))?.toISOString()).toBe("2026-03-31T01:00:00.000Z");
    expect(nextOccurrence("interval", { intervalMinutes: 30 }, previous, previous)?.toISOString()).toBe("2026-01-31T01:30:00.000Z");
  });

  it("skips missed occurrences instead of replaying a backlog", () => {
    const previous = new Date("2026-08-01T00:00:00.000Z");
    const now = new Date("2026-08-01T03:05:00.000Z");
    expect(nextOccurrence("interval", { intervalMinutes: 60 }, previous, now)?.toISOString()).toBe("2026-08-01T04:00:00.000Z");
  });
});
