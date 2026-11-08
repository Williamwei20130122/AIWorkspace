import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { Button, buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/form";
import {
  IconArrowRight,
  IconBook,
  IconCheck,
  IconClipboard,
  IconClock,
  IconClose,
  IconPlus,
  IconSearch,
} from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { CreateTopicForm } from "@/components/teacher/CreateTopicForm";
import { ErrorState, LoadingState } from "@/components/teacher/Feedback";
import { TopicStatusBadge } from "@/components/teacher/StatusBadge";
import { api, errorMessage } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/format";
import type { TopicPage, TopicStatus, TopicSummary } from "@/lib/types";

type StatusFilter = "ALL" | TopicStatus;

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "全部" },
  { value: "ACTIVE", label: "进行中" },
  { value: "CLOSED", label: "已关闭" },
];

const PAGE_SIZES = [8, 12, 20];

/** 页码窗口：最多 7 个可点击页码 */
function pageNumbers(current: number, totalPages: number): number[] {
  const max = 7;
  if (totalPages <= max) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  let start = Math.max(1, current - 3);
  const end = Math.min(totalPages, start + max - 1);
  start = Math.max(1, end - max + 1);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export default function TeacherTopics() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState<TopicPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const appliedKeywordRef = useRef("");
  const requestSeqRef = useRef(0);

  const applyKeyword = useCallback((raw: string) => {
    const next = raw.trim();
    if (next === appliedKeywordRef.current) return;
    appliedKeywordRef.current = next;
    setKeyword(next);
    setPage(1);
  }, []);

  // 搜索：停止输入 300ms 后自动应用（回车可立即应用）
  useEffect(() => {
    const timer = window.setTimeout(() => applyKeyword(keywordInput), 300);
    return () => window.clearTimeout(timer);
  }, [keywordInput, applyKeyword]);

  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (status !== "ALL") params.set("status", status);
      if (keyword) params.set("keyword", keyword);
      const result = await api.get<TopicPage>(`/api/teacher/topics?${params.toString()}`);
      if (seq === requestSeqRef.current) setData(result);
    } catch (err) {
      if (seq === requestSeqRef.current) {
        setError(errorMessage(err, "课题列表加载失败，请刷新页面重试"));
      }
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [page, pageSize, status, keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  // 抽屉打开时支持 Esc 关闭
  useEffect(() => {
    if (!createOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCreateOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createOpen]);

  if (!user) return null;

  const stats = data?.stats ?? { active: 0, closed: 0, pendingTotal: 0 };
  const topicTotal = stats.active + stats.closed;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const activePercent = topicTotal > 0 ? Math.round((stats.active / topicTotal) * 100) : 0;
  const closedPercent = topicTotal > 0 ? 100 - activePercent : 0;
  const filterActive = keyword !== "" || status !== "ALL";

  function changeStatus(next: StatusFilter) {
    if (next === status) return;
    setStatus(next);
    setPage(1);
  }

  function changePageSize(next: number) {
    if (next === pageSize) return;
    setPageSize(next);
    setPage(1);
  }

  function clearFilters() {
    setKeywordInput("");
    applyKeyword("");
    setKeyword("");
    setStatus("ALL");
    setPage(1);
  }

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="教师工作台"
        title="我的课题"
        description="用一个仪表盘跟进所有课题：筛选、搜索与分页都在这里，点进课题即可管理学生、维度与评价。"
        actions={
          <>
            <Link to="/teacher/evaluations" className={buttonClass("secondary", "sm")}>
              评价汇总
            </Link>
            <Button
              type="button"
              variant="accent"
              size="sm"
              onClick={() => setCreateOpen(true)}
              aria-haspopup="dialog"
            >
              <IconPlus className="size-4" />
              新建课题
            </Button>
          </>
        }
      />

      {!data && loading ? (
        <LoadingState label="正在加载课题…" />
      ) : !data && error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : data ? (
        <div className="space-y-6">
          {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

          {/* 仪表盘 */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="课题总数" value={topicTotal} hint="我创建或协助的全部课题" icon={<IconBook />} tone="brand" />
            <StatCard label="进行中" value={stats.active} hint="学生仍可提交" icon={<IconCheck />} tone="success" />
            <StatCard label="已关闭" value={stats.closed} hint="已停止提交，只读历史" icon={<IconClock />} tone="neutral" />
            <StatCard
              label="待评价"
              value={stats.pendingTotal}
              hint={stats.pendingTotal > 0 ? "学生正在等反馈" : "所有提交都已评价"}
              icon={<IconClipboard />}
              tone={stats.pendingTotal > 0 ? "accent" : "success"}
            />
          </div>

          <div className="aw-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-brand-900">课题状态分布</h2>
              <span className="text-xs text-ink-soft">
                进行中 {stats.active} 个 · 已关闭 {stats.closed} 个
              </span>
            </div>
            <div
              className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`进行中 ${activePercent}%，已关闭 ${closedPercent}%`}
            >
              <span className="h-full bg-emerald-500 transition-[width]" style={{ width: `${activePercent}%` }} />
              <span className="h-full bg-slate-400 transition-[width]" style={{ width: `${closedPercent}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-soft">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
                进行中 {activePercent}%
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-slate-400" aria-hidden="true" />
                已关闭 {closedPercent}%
              </span>
              <span className="text-ink-soft/80">
                {stats.pendingTotal > 0
                  ? `共 ${stats.pendingTotal} 份提交待评价`
                  : "暂无待评价提交"}
              </span>
            </div>
          </div>

          {/* 工具条 */}
          <div className="aw-card px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="w-full lg:max-w-sm">
                <div className="flex items-center gap-2 rounded-[10px] border border-line bg-white px-3 transition-colors focus-within:border-brand-600 focus-within:ring-[3px] focus-within:ring-brand-600/15">
                  <IconSearch className="size-4 shrink-0 text-ink-soft/60" />
                  <input
                    type="search"
                    aria-label="搜索课题标题"
                    placeholder="搜索课题标题，回车立即搜索"
                    value={keywordInput}
                    onChange={(event) => setKeywordInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        applyKeyword(keywordInput);
                      }
                    }}
                    className="w-full min-w-0 bg-transparent py-2.5 text-sm text-ink outline-none placeholder:text-ink-soft/50"
                  />
                  {keywordInput ? (
                    <button
                      type="button"
                      aria-label="清空搜索"
                      className="grid size-6 shrink-0 place-items-center rounded-md text-ink-soft transition-colors hover:bg-muted hover:text-brand-800"
                      onClick={() => {
                        setKeywordInput("");
                        applyKeyword("");
                      }}
                    >
                      <IconClose className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div
                  className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-line bg-white p-0.5"
                  role="group"
                  aria-label="按课题状态筛选"
                >
                  {STATUS_TABS.map((tab) => {
                    const count =
                      tab.value === "ALL"
                        ? topicTotal
                        : tab.value === "ACTIVE"
                          ? stats.active
                          : stats.closed;
                    const selected = status === tab.value;
                    return (
                      <button
                        key={tab.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => changeStatus(tab.value)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                          selected
                            ? "bg-brand-50 text-brand-700"
                            : "text-ink-soft hover:text-brand-700",
                        )}
                      >
                        {tab.label}
                        <span className="tabular-nums text-ink-soft/80">{count}</span>
                      </button>
                    );
                  })}
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-ink-soft">
                  每页
                  <span className="inline-block w-24">
                    <Select
                      aria-label="每页显示条数"
                      value={pageSize}
                      onChange={(event) => changePageSize(Number(event.target.value))}
                    >
                      {PAGE_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {size} 条
                        </option>
                      ))}
                    </Select>
                  </span>
                </label>
              </div>
            </div>

            {filterActive ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                <span>当前筛选：</span>
                {keyword ? <span className="font-medium text-brand-700">关键词「{keyword}」</span> : null}
                {status !== "ALL" ? (
                  <span className="font-medium text-brand-700">{status === "ACTIVE" ? "进行中" : "已关闭"}</span>
                ) : null}
                <button
                  type="button"
                  className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700"
                  onClick={clearFilters}
                >
                  清除筛选
                </button>
              </div>
            ) : null}
          </div>

          {/* 列表：桌面表格 / 移动卡片 */}
          {data.items.length === 0 ? (
            filterActive ? (
              <EmptyState
                icon={<IconSearch />}
                title="没有匹配的课题"
                description={
                  keyword
                    ? `没有找到标题包含「${keyword}」的课题，换个关键词或状态试试。`
                    : "当前状态下没有课题，换个筛选条件试试。"
                }
                action={
                  <Button type="button" variant="secondary" size="sm" onClick={clearFilters}>
                    清除筛选
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<IconBook />}
                title="还没有课题"
                description="创建第一个课题，添加学生后就可以收到提交并评价。"
                action={
                  <Button type="button" variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                    新建课题
                  </Button>
                }
              />
            )
          ) : (
            <>
              <div
                className={cn("hidden overflow-hidden aw-card xl:block", loading && "opacity-60")}
                aria-busy={loading}
              >
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-brand-50/60 text-xs text-ink-soft">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">课题</th>
                      <th scope="col" className="px-3 py-3 font-semibold">班级</th>
                      <th scope="col" className="px-3 py-3 font-semibold">状态</th>
                      <th scope="col" className="px-3 py-3 font-semibold">负责人</th>
                      <th scope="col" className="px-3 py-3 text-right font-semibold">成员</th>
                      <th scope="col" className="px-3 py-3 text-right font-semibold">提交</th>
                      <th scope="col" className="px-3 py-3 text-right font-semibold">待评价</th>
                      <th scope="col" className="px-3 py-3 font-semibold">更新时间</th>
                      <th scope="col" className="px-4 py-3 text-right font-semibold">
                        <span className="sr-only">操作</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.items.map((topic) => (
                      <tr key={topic.id} className="transition-colors hover:bg-brand-50/40">
                        <td className="max-w-72 px-4 py-3">
                          <Link
                            to={`/teacher/topics/${topic.id}`}
                            className="block truncate font-semibold text-brand-900 hover:text-brand-700"
                            title={topic.title}
                          >
                            {topic.title}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-xs text-ink-soft">
                          {topic.className || "—"}
                        </td>
                        <td className="px-3 py-3">
                          <TopicStatusBadge status={topic.status} />
                        </td>
                        <td className="px-3 py-3 text-ink-soft">
                          <span className="flex flex-wrap items-center gap-1.5">
                            {topic.owner.name}
                            <span
                              className={cn(
                                "rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                                topic.isOwner
                                  ? "border-brand-200 bg-brand-50 text-brand-700"
                                  : "border-line bg-muted text-ink-soft",
                              )}
                            >
                              {topic.isOwner ? "我创建" : "助教"}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-ink-soft">
                          {topic.memberCount}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-ink-soft">
                          {topic.submissionCount}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {topic.pendingCount > 0 ? (
                            <span className="font-semibold text-amber-700">{topic.pendingCount}</span>
                          ) : (
                            <span className="text-ink-soft/70">0</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs text-ink-soft">{formatDateTime(topic.updatedAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={`/teacher/topics/${topic.id}`}
                            className={buttonClass("secondary", "sm")}
                          >
                            查看
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul
                className={cn("grid gap-3 md:grid-cols-2 xl:hidden", loading && "opacity-60")}
                aria-busy={loading}
              >
                {data.items.map((topic) => (
                  <li key={topic.id}>
                    <TopicMobileCard topic={topic} />
                  </li>
                ))}
              </ul>

              {/* 分页 */}
              <div className="flex flex-col gap-3 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-ink-soft">
                  第 <span className="font-semibold text-brand-800">{safePage}</span> / {totalPages} 页，共{" "}
                  <span className="font-semibold text-brand-800">{total}</span> 条
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={safePage <= 1 || loading}
                    onClick={() => setPage(Math.max(1, safePage - 1))}
                  >
                    上一页
                  </Button>
                  {pageNumbers(safePage, totalPages).map((pageNumber) => {
                    const current = pageNumber === safePage;
                    return (
                      <button
                        key={pageNumber}
                        type="button"
                        aria-label={`第 ${pageNumber} 页`}
                        aria-current={current ? "page" : undefined}
                        disabled={loading}
                        onClick={() => setPage(pageNumber)}
                        className={cn(
                          "min-w-8 rounded-lg border px-2.5 py-1.5 text-xs font-semibold tabular-nums transition-colors disabled:cursor-not-allowed",
                          current
                            ? "border-brand-600 bg-brand-600 text-white"
                            : "border-line bg-white text-brand-800 hover:border-brand-300 hover:bg-brand-50",
                        )}
                      >
                        {pageNumber}
                      </button>
                    );
                  })}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={safePage >= totalPages || loading}
                    onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* 新建课题抽屉 */}
      {createOpen ? (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label="关闭新建课题面板"
            className="absolute inset-0 bg-brand-900/40"
            onClick={() => setCreateOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-topic-drawer-title"
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-line bg-white"
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 id="create-topic-drawer-title" className="text-base font-semibold text-brand-900">
                  新建课题
                </h2>
                <p className="mt-1 text-xs leading-5 text-ink-soft">
                  选择班级、勾选参与学生（默认全选），介绍页、成员与评价维度稍后在详情页完善。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭新建课题面板"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-brand-50 hover:text-brand-800"
                onClick={() => setCreateOpen(false)}
              >
                <IconClose className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto aw-scroll px-5 py-4">
              <CreateTopicForm
                onCreated={(topicId) => {
                  setCreateOpen(false);
                  navigate(`/teacher/topics/${topicId}`);
                }}
              />
            </div>
          </aside>
        </div>
      ) : null}
    </AppShell>
  );
}

function TopicMobileCard({ topic }: { topic: TopicSummary }) {
  return (
    <Link
      to={`/teacher/topics/${topic.id}`}
      className="aw-card group flex flex-col gap-3 p-4 transition-colors hover:border-brand-300"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-semibold text-brand-900 group-hover:text-brand-700">
          {topic.title}
        </h3>
        <TopicStatusBadge status={topic.status} />
      </div>

      <p className="text-xs text-ink-soft">
        负责人 {topic.owner.name}
        <span
          className={cn(
            "ml-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
            topic.isOwner ? "border-brand-200 bg-brand-50 text-brand-700" : "border-line bg-muted text-ink-soft",
          )}
        >
          {topic.isOwner ? "我创建" : "助教"}
        </span>
        {topic.className ? <span className="ml-2">班级 {topic.className}</span> : null}
      </p>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div className="flex items-center justify-between rounded-lg bg-muted/60 px-2.5 py-1.5">
          <dt className="text-ink-soft">成员</dt>
          <dd className="font-semibold tabular-nums text-brand-900">{topic.memberCount}</dd>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-muted/60 px-2.5 py-1.5">
          <dt className="text-ink-soft">提交</dt>
          <dd className="font-semibold tabular-nums text-brand-900">{topic.submissionCount}</dd>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-muted/60 px-2.5 py-1.5">
          <dt className="text-ink-soft">待评价</dt>
          <dd
            className={cn(
              "font-semibold tabular-nums",
              topic.pendingCount > 0 ? "text-amber-700" : "text-brand-900",
            )}
          >
            {topic.pendingCount}
          </dd>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-muted/60 px-2.5 py-1.5">
          <dt className="text-ink-soft">更新</dt>
          <dd className="text-brand-900">{formatDateTime(topic.updatedAt)}</dd>
        </div>
      </dl>

      <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 group-hover:text-brand-700">
        查看课题详情
        <IconArrowRight className="size-3.5" />
      </span>
    </Link>
  );
}
