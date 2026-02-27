import type { TransferFailureCode } from './types';

export type TransferException = Error & {
  code: TransferFailureCode;
};

export function createTransferException(
  code: TransferFailureCode,
  message: string,
  cause?: unknown,
): TransferException {
  const error = new Error(message) as TransferException;
  error.code = code;

  if (cause !== undefined) {
    (error as Error & { cause?: unknown }).cause = cause;
  }

  return error;
}

export function transferErrorCode(
  error: unknown,
  fallback: TransferFailureCode,
): TransferFailureCode {
  if (isTransferException(error)) {
    return error.code;
  }

  return fallback;
}

export function isTransferException(error: unknown): error is TransferException {
  if (!(error instanceof Error)) return false;
  return typeof (error as { code?: unknown }).code === 'string';
}
