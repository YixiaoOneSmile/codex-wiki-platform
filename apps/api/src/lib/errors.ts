export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = () => new AppError(401, "UNAUTHORIZED", "请先登录");
export const forbidden = () => new AppError(403, "FORBIDDEN", "没有执行此操作的权限");
export const notFound = () => new AppError(404, "NOT_FOUND", "请求的内容不存在");
