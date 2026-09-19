import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { PixelEvent } from '@zaa4eem/shared';

/**
 * In-process fan-out of placements to every open canvas.
 *
 * Same trade-off as NotificationEventsService, and the same reason it is
 * safe: a dropped event costs a viewer one stale cell until they reload the
 * snapshot, because the database — not this stream — is the canvas. Going
 * multi-instance would mean swapping the Subject for Redis pub/sub without
 * touching either caller.
 *
 * Unlike notifications, this stream is not per-user: the canvas is public,
 * so every subscriber gets every placement.
 */
@Injectable()
export class PixelEventsService {
  private readonly stream$ = new Subject<PixelEvent>();

  publish(event: PixelEvent) {
    this.stream$.next(event);
  }

  all(): Observable<PixelEvent> {
    return this.stream$.asObservable();
  }
}
