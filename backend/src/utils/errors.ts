export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly expose = true
  ) {
    super(message);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Error desconocido";
}
