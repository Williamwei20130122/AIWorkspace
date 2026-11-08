import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import type { SubmitMode } from "@/lib/types";
import type { TeacherTopicDetail } from "@/components/teacher/v4types";

const MAX_GROUP_SIZE = 50;

/**
 * 课题分组设置（仅创建者可改）：
 * - 提交模式：个人 / 小组
 * - 每组人数上下限
 * - 允许学生自行组队
 */
export function GroupSettings({
  topic,
  canEdit,
  onChanged,
}: {
  topic: TeacherTopicDetail;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [modePending, setModePending] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);

  const [minInput, setMinInput] = useState(String(topic.groupMin));
  const [maxInput, setMaxInput] = useState(String(topic.groupMax));
  const [configPending, setConfigPending] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSuccess, setConfigSuccess] = useState<string | null>(null);

  const [allowPending, setAllowPending] = useState(false);
  const [allowError, setAllowError] = useState<string | null>(null);

  useEffect(() => {
    setMinInput(String(topic.groupMin));
    setMaxInput(String(topic.groupMax));
  }, [topic.groupMin, topic.groupMax]);

  async function changeMode(next: SubmitMode) {
    if (!canEdit || modePending || next === topic.submitMode) return;
    setModePending(true);
    setModeError(null);
    try {
      await api.patch(`/api/teacher/topics/${topic.id}`, { submitMode: next });
      onChanged();
    } catch (err) {
      setModeError(errorMessage(err, "提交模式切换失败，请稍后重试"));
    } finally {
      setModePending(false);
    }
  }

  async function saveGroupLimit() {
    if (!canEdit || configPending) return;

    const min = Number(minInput);
    const max = Number(maxInput);
    if (!Number.isInteger(min) || min < 1 || min > MAX_GROUP_SIZE) {
      setConfigSuccess(null);
      setConfigError("每组最少人数需为 1–50 的整数");
      return;
    }
    if (!Number.isInteger(max) || max < 1 || max > MAX_GROUP_SIZE) {
      setConfigSuccess(null);
      setConfigError("每组最多人数需为 1–50 的整数");
      return;
    }
    if (min > max) {
      setConfigSuccess(null);
      setConfigError("每组最少人数不能大于最多人数");
      return;
    }

    setConfigPending(true);
    setConfigError(null);
    setConfigSuccess(null);
    try {
      await api.patch(`/api/teacher/topics/${topic.id}`, { groupMin: min, groupMax: max });
      setConfigSuccess("分组人数已更新");
      onChanged();
    } catch (err) {
      setConfigError(errorMessage(err, "分组人数保存失败，请稍后重试"));
    } finally {
      setConfigPending(false);
    }
  }

  async function toggleAllowStudentGroups() {
    if (!canEdit || allowPending) return;
    setAllowPending(true);
    setAllowError(null);
    try {
      await api.patch(`/api/teacher/topics/${topic.id}`, {
        allowStudentGroups: !topic.allowStudentGroups,
      });
      onChanged();
    } catch (err) {
      setAllowError(errorMessage(err, "开关更新失败，请稍后重试"));
    } finally {
      setAllowPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 提交模式 */}
      <section>
        <p className="text-[13px] font-semibold text-ink-soft">提交模式</p>
        <div className="mt-1.5 inline-flex rounded-xl border border-line bg-white p-0.5" role="group" aria-label="提交模式">
          {(
            [
              { value: "INDIVIDUAL", label: "个人提交" },
              { value: "GROUP", label: "小组提交" },
            ] as const
          ).map((item) => {
            const selected = topic.submitMode === item.value;
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={selected}
                disabled={!canEdit || modePending}
                onClick={() => void changeMode(item.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed",
                  selected
                    ? "bg-brand-50 text-brand-700"
                    : "text-ink-soft hover:text-brand-700",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs leading-5 text-ink-soft">
          {topic.submitMode === "GROUP"
            ? "小组共享一份提交与附件，评价针对小组，组员都能看到；小组提交需要组人数达到下限。"
            : "每位学生独立提交与评价；如需小组协作，切换到「小组提交」后再配置分组。"}
        </p>
        <FormMessage error={modeError ?? undefined} />
      </section>

      {/* 人数上下限 */}
      <section className="border-t border-line pt-4">
        <p className="text-[13px] font-semibold text-ink-soft">每组人数</p>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Field label="最少" htmlFor="group-min">
            <Input
              id="group-min"
              type="number"
              min={1}
              max={MAX_GROUP_SIZE}
              step={1}
              value={minInput}
              disabled={!canEdit || configPending}
              onChange={(event) => setMinInput(event.target.value)}
            />
          </Field>
          <Field label="最多" htmlFor="group-max">
            <Input
              id="group-max"
              type="number"
              min={1}
              max={MAX_GROUP_SIZE}
              step={1}
              value={maxInput}
              disabled={!canEdit || configPending}
              onChange={(event) => setMaxInput(event.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canEdit || configPending}
              onClick={() => void saveGroupLimit()}
            >
              {configPending ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
        <p className="mt-1 text-xs text-ink-soft">
          创建/加入小组不能超过「最多」；小组提交要求组人数 ≥「最少」。
        </p>
        <FormMessage error={configError ?? undefined} success={configSuccess ?? undefined} />
      </section>

      {/* 允许学生自组 */}
      <section className="border-t border-line pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink-soft">允许学生自行组队</p>
            <p className="mt-0.5 text-xs leading-5 text-ink-soft">
              开启后学生可以自己创建小组、加入未满的小组或退出小组；关闭时只能由老师分组。
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={topic.allowStudentGroups}
            aria-label="允许学生自行组队"
            disabled={!canEdit || allowPending}
            onClick={() => void toggleAllowStudentGroups()}
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed",
              topic.allowStudentGroups
                ? "border-brand-600 bg-brand-600"
                : "border-line bg-muted",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-4 rounded-full bg-white transition-[left]",
                topic.allowStudentGroups ? "left-[26px]" : "left-0.5",
              )}
            />
          </button>
        </div>
        <p className="mt-1.5 text-xs font-medium text-ink-soft">
          当前：{topic.allowStudentGroups ? "允许学生自行组队" : "由老师分组"}
        </p>
        <FormMessage error={allowError ?? undefined} />
      </section>

      {!canEdit ? (
        <p className="rounded-lg border border-line bg-white/60 px-3 py-2 text-xs text-ink-soft">
          提交模式与分组设置仅课题创建者可修改；你可以管理下方的小组。
        </p>
      ) : null}
    </div>
  );
}
