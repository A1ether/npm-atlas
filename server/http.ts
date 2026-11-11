export class HttpError extends Error {
  status: 400 | 403 | 404 | 500;

  constructor(status: 400 | 403 | 404 | 500, message: string) {
    super(message);
    this.status = status;
  }
}
