/** 统一的 fetch 封装：JSON、错误处理、401 跳登录 */

export class ApiError extends Error {
  status: number;
  /** 服务端返回的 JSON 体（如 409 的 conflict 字段） */
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  const res = await fetch(path, {
    method: options.method ?? "GET",
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });

  return parseResponse<T>(res);
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    if (window.location.pathname !== "/login") {
      window.location.assign("/login");
    }
    throw new ApiError("登录已过期，请重新登录", 401);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `请求失败（${res.status}）`;
    throw new ApiError(message, res.status, data);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  /** 文件上传：multipart/form-data，不要手动设置 Content-Type */
  upload: async <T>(path: string, formData: FormData): Promise<T> => {
    const res = await fetch(path, {
      method: "POST",
      body: formData,
      credentials: "same-origin",
    });
    return parseResponse<T>(res);
  },
};

/** 页面里统一取错误文案 */
export function errorMessage(error: unknown, fallback = "操作失败，请稍后重试"): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
