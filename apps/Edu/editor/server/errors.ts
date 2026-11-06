export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '작업을 완료하지 못했습니다.';
}
