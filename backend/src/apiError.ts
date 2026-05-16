import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'
  | string;

export type ApiErrorBody = {
  code: ApiErrorCode;
  message: string;
  requestId: string;
};

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : randomUUID();
  (req as any).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

export function apiErrorBody(req: Request, code: ApiErrorCode, message: string): ApiErrorBody {
  return {
    code,
    message,
    requestId: (req as any).requestId ?? 'unknown',
  };
}

export function sendApiError(
  req: Request,
  res: Response,
  status: number,
  code: ApiErrorCode,
  message: string,
) {
  res.status(status).json(apiErrorBody(req, code, message));
}

export function codeForStatus(status: number): ApiErrorCode {
  if (status === 400) return 'BAD_REQUEST';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409 || status === 410) return 'CONFLICT';
  return 'INTERNAL_ERROR';
}
