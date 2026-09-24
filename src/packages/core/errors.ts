export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false) { super(message); }
}
export function safeError(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof AppError) return { code: error.code, message: error.message, retryable: error.retryable };
  return { code: 'IPC004', message: '操作失败，请检查连接、文件权限和可用空间。', retryable: false };
}
export function invariant(value: unknown, code: string, message: string): asserts value {
  if (!value) throw new AppError(code, message);
}
