/**
 * Safely extracts the message from an error object
 * Works with both Error objects and unknown types
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error &&
      typeof (error as Record<string, unknown>).message === 'string') {
    return (error as { message: string }).message;
  }

  return String(error);
}
