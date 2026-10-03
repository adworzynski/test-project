/** An error whose message is meant for the user; the CLI prints it without a stack trace. */
export class KeelError extends Error {
  constructor(
    message: string,
    public readonly exitCode = 1,
    public readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'KeelError';
  }
}
