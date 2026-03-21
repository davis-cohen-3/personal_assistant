export class AppError extends Error {
  public readonly userFacing: boolean;

  constructor(
    message: string,
    public readonly status: number = 500,
    options?: ErrorOptions & { userFacing?: boolean },
  ) {
    super(message, options);
    this.name = "AppError";
    this.userFacing = options?.userFacing ?? false;
  }
}
