export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly expose = true,
    public readonly cause?: unknown
  ) {
    super(message);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Error desconocido";
}

export function serverErrorMessage(error: unknown): string {
  if (error instanceof AppError && error.cause !== undefined) {
    return `${error.message}: ${serverErrorMessage(error.cause)}`;
  }
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}
