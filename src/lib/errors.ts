/** Error de negocio con mensaje apto para mostrar al usuario (en español). */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string = "DOMAIN_ERROR",
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = "Su sesión expiró. Vuelva a ingresar.") {
    super(message, "UNAUTHENTICATED");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(readonly permission: string) {
    super("No tiene permiso para realizar esta operación.", "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends DomainError {
  constructor(fieldErrors: Record<string, string[]>, message = "Revise los datos ingresados.") {
    super(message, "VALIDATION", fieldErrors);
    this.name = "ValidationError";
  }
}
