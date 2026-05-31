export class AppError extends Error {
    statusCode;
    expose;
    constructor(statusCode, message, expose = true) {
        super(message);
        this.statusCode = statusCode;
        this.expose = expose;
    }
}
export function errorMessage(error) {
    return error instanceof Error ? error.message : "Error desconocido";
}
