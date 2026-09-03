import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/**
 * Normalizes every thrown error into the { statusCode, error, message }
 * shape documented in specs/001-zaa4eem-platform/contracts/api.md.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as Record<string, unknown>).message ?? exception.message);

      response.status(status).json({
        statusCode: status,
        error: exception.name,
        message,
      });
      return;
    }

    // Route/query validation via `<schema>.parse(body)` throws a raw ZodError
    // (there's no class-validator DTO for the global ValidationPipe to catch
    // instead) — without this, every validation failure fell through to the
    // generic 500 below, hiding real form errors ("password too short",
    // "title too short") behind "Something went wrong".
    if (exception instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'ValidationError',
        message: exception.issues[0]?.message ?? 'Некорректные данные',
      });
      return;
    }

    // eslint-disable-next-line no-console
    console.error(exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'InternalServerError',
      message: 'Что-то пошло не так. Попробуйте ещё раз.',
    });
  }
}
