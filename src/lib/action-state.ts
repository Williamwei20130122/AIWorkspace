/**
 * Server Action 的统一状态形状。
 * 页面里用 React 19 的 useActionState(action, initialState) 绑定表单：
 *
 *   const [state, formAction, pending] = useActionState(loginAction, initialActionState);
 *
 * Action 成功时一般直接 redirect()；需要停留在本页时返回 { success }。
 */
export type ActionState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
};

export const initialActionState: ActionState = {};
